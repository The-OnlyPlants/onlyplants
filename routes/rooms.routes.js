const router = require('express').Router();
const { isLoggedIn, isOwnRoom } = require('../middlewares/routes.guard');
const Room = require('../models/Room.model');
const User = require('../models/User.model');
const Plant = require('../models/Plant.model');
const { ObjectId } = require('mongoose').Types;
const { convertUsernamesToIds, convertIdsToUsernames } = require('../utils/convertUsernamesToIds');

router.get('/', isLoggedIn, async (req, res, next) => {
    const { id } = req.session.user;

    User.findById( id )
        .populate('plants')
        .populate({ 
            path: 'rooms',
            populate: {
                path: 'inviteesId',
                select: [ 'username', 'avatarUrl'],
                model: 'User'
            },
        })
        
        .then(user => {
            if ( !user ) { res.redirect('/'); return; }
            res.render('rooms/view', { user })
        })
        .catch((err => console.log(err)));
});

router.get('/create', isLoggedIn, async (req, res, next) => {
    const users = await User.find( {}, { username: 1, avatarUrl: 1 })
                            .catch(err => console.log(err));

    if ( req.session.user.error ) {
        const errorMessage = req.session.user.error;
        delete req.session.user.error;
        res.render('rooms/create', { users, errorMessage });
        return;
    }

    res.render('rooms/create', { users });
});

router.post('/create', isLoggedIn, async (req, res, next) => {
    const { name, inviteesList } = req.body;
    const slug = name.replaceAll(/[^\w\s]/gi, '').replaceAll(' ', '-').toLowerCase();
    let { id } = req.session.user;
    let nameAlreadyTaken = false;

    if ( !name ) { req.session.user.error = `Please fill out all required fields.`; res.redirect(`/rooms/create`); return; }
    if ( name.length < 3 ) { req.session.user.error = `The name of the room must contain at least 3 characters.`; res.redirect(`/rooms/create`); return; }
    else if ( name.length > 15 ) { req.session.user.error = `The name of the room should be 15 character maximum.`; res.redirect(`/rooms/create`); return; }

    const checkRoomName = await User.findById( id )
            .populate('rooms')
            .then(user => {
                for ( i = 0 ; i < user.rooms.length ; i++ ) {
                    if ( user.rooms[i].name !== name ) continue;
                    return nameAlreadyTaken = true;
                }
            })
            .catch(err => console.log(err));

    if (nameAlreadyTaken) {
        req.session.user.error = name;
        res.redirect('/rooms/create');
        return;
    }
    
    const inviteesIds = await Promise.all(convertUsernamesToIds(inviteesList));

    const room = await Room.create( { name, slug, ownerId: id } )
                        .then(room => {
                            if (inviteesList != '') {
                                inviteesIds.forEach(inviteeId => {
                                    room.inviteesId.push(inviteeId);
                                })
                                room.save();
                            }
                            return room;
                        });

    await User.findById( id )
            .then(user => {
                user.rooms.push(room._id);
                user.save();
            })
            .catch(err => console.log(err));

    res.redirect('/rooms');
});

router.get('/:roomId', isLoggedIn, (req, res, next) => {
    const { roomId } = req.params;
    const room = Room.findById( roomId );

    res.render('rooms/view', { room });
});

router.get('/:roomId/edit', isOwnRoom, async (req, res, next) => {
    const { roomId } = req.params;
    const room = await Room.findById( roomId );
    const userId = req.session.user.id;
    
    const inviteesUsernames = await Promise.all(convertIdsToUsernames(room.inviteesId))

    const users = await User.find( { '_id' : { '$ne' : userId  } }, { username: 1, avatarUrl: 1 })
                            .catch(err => console.log(err));
                            
    if ( req.session.user.error ) {
        const errorMessage = req.session.user.error;
        delete req.session.user.error;
        res.render('rooms/edit', { room, users, inviteesUsernames, errorMessage });
        return;
    }

    res.render('rooms/edit', { room, users, inviteesUsernames });
});

router.post('/:roomId/edit', isOwnRoom, async (req, res, next) => {
    const { name, inviteesList } = req.body;
    const slug = name.replaceAll(/[^\w\s]/gi, '').replaceAll(' ', '-').toLowerCase();
    const { roomId } = req.params;
    const { id } = req.session.user;
    let nameAlreadyTaken = false;

    if ( !name ) { req.session.user.error = `Please fill out all required fields.`; res.redirect(`/rooms/${ roomId }/edit`); return; }
    if ( name.length < 3 ) { req.session.user.error = `The name of the room must contain at least 3 characters.`; res.redirect(`/rooms/${ roomId }/edit`); return; }
    else if ( name.length > 15 ) { req.session.user.error = `The name of the room should be 15 character maximum.`; res.redirect(`/rooms/${ roomId }/edit`); return; }

    const checkRoomName = await User.findById( id )
            .populate('rooms')
            .then(user => {
                for ( i = 0 ; i < user.rooms.length ; i++ ) {
                    if ( user.rooms[i]._id.equals(roomId) ) continue;
                    if ( user.rooms[i].name !== name ) continue;
                    nameAlreadyTaken = true;
                    return;
                }
            })
            .catch(err => console.log(err));

    if (nameAlreadyTaken) { 
        req.session.user.error = `You already have a room "${ existingName }". Please choose another name.`;
        res.redirect(`/rooms/${ roomId }/edit`);
        return;
     }
    
    const inviteesIds = await Promise.all(convertUsernamesToIds(inviteesList));

    await Room.findByIdAndUpdate( roomId, { name, slug, $set: { inviteesId: [] } })
        .then(room => {
            if ( inviteesList !== '' ) {
                inviteesIds.forEach(inviteeId => {
                    room.inviteesId.push(inviteeId);
                });
                room.save();
            }
        })

    res.redirect('/rooms');
});

router.post('/:roomId/delete', isOwnRoom, async (req, res, next) => {

    const { roomId } = req.params;

    const user = await User.findById( req.session.user.id ).populate('rooms').catch(err => console.log(err));

    if (user.rooms.length === 1) { 
        const room = await Room.findById( roomId ).catch(err => console.log(err));
        res.render(`rooms/edit`, { room, errorMessage: `You only have one room, you can't delete it.`}); return; 
    };

    const deletedRoom = await Room.findByIdAndDelete( roomId ).catch(err => console.log(err));
    await Plant.deleteMany({ 'room' : deletedRoom._id }).catch(err => console.log(err));
    await User.findByIdAndUpdate( req.session.user.id, { $pull: { rooms: ObjectId(roomId) }});

    res.redirect('/rooms');

});

module.exports = router;