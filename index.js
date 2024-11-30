const KEEPALIVETIME = 12500 // in milliseconds, also used to update the userlist
const MAXPACKETSIZE = 2500  // in bytes
const MAXUSERNAMESIZE = 200 // in bytes
const port = 1958 // port  the server runs on
const LOGGING = true // whether to log debug stuff


const WS = require("ws")
const crypto = require("crypto")
let ROOMS = {}
let USERS = {}

const wss = new WS.WebSocketServer({
    port: port
})


/*
command.type values. how do i do this with jsdoc.

"username" - Requests a username to be set
meta: String for the username

response: 
validate, if the username is already taken or something else, respond with an error code. otherwise 202(accepted)

"packet" - A packet which will be forwarded to the provided targets.
response: forward, any

"room" - Connect to the first room in the provided target list, and create it if it doesn't exist
response: validate, a response code based on whether that connection happened

on connection user is sent a packet containing a username in the data and a type of -1.
*/

/**
 * @readonly
 * @enum {String} 
 */
const ResponseTypes = {
    forward: "forward",
    validate: "validate"
}
/**
 * @readonly
 * @enum {String}
 */
const PacketTypes = {
    username: "username",
    packet: "packet",
    room: "room",
    userlist: "userlist"
}

/**
 * @readonly
 * @enum {Number}
 */
const PacketStates = {
    response: 0,
    packet: 1
}

/**
 * @typedef Room
 * @property {WS.WebSocket[]} connections The usernames connected to the room
 * @property {Number} startTime The Date.now() that this room started
 */

/**
 * @typedef ClientPacket
 * @property {Object} command Information about this packet, and/or what it's doing
 * @property {PacketTypes} command.type The command type.
 * @property {*} command.meta Metadata about the command
 * @property {String[] | null | Number[] | true} targets Affected targets, if a list of strings forward to those usernames. If a number, forward to all clients in that room id. If true, forward to all clients in the sender's current room. If null don't forward.
 * @property {*} data The data to send
 * @property {Number} id The packet id, used to identify handshake stuff. Date.now()
 * @property {Number} packetState The packet type. 0 = response, 1 = packet
 */

/**
 * @typedef ServerPacket
 * @property {Object} command Information about this packet, and/or what it's doing
 * @property {PacketTypes} command.type The command type.
 * @property {*} command.meta Metadata about the command
 * @property {*} data The data to send
 * @property {Number} id The packet id, used to identify handshake stuff. Date.now()
 * @property {Number} packetState The packet type. 0 = response, 1 = packet
 * @property {String} sender The user who sent this packet. null = server.
 */



/**
 * @typedef ClientResponse
 * @property {Number} status Corresponds to an http status code
 * @property {*} data The response's data
 * @property {Number} id The packet id this is responding to, used to identify handshake stuff
 * @property {ResponseTypes} type The type of response this is.
 * @property {PacketTypes} originType The type of packet that initiated this packet
 * @property {Number} packetState The packet type. 0 = response, 1 = packet
 */

/**
 * @typedef ServerResponse
 * @property {Number} status Corresponds to an http status code
 * @property {*} data The response's data
 * @property {Number} id The packet id this is responding to, used to identify handshake stuff
 * @property {ResponseTypes} type The type of response this is.
 * @property {PacketTypes} originType The type of packet that initiated this packet
 * @property {Number} packetState The packet type. 0 = response, 1 = packet
 */



/**
 * 
 * @param {*} obj The object to get the size of 
 * @returns {Number}
 */
const byteSize = obj => new Blob([obj]).size
const popIndex = (array, index) => array.splice(index, 1)

/**
 * 
 * @param {Number} status The http status code of the response
 * @param {*} data The data to send back
 * @param {Number} id The id of the packet that this is responding to
 * @param {"forward" | "validate"} type The response type
 * @param {PacketTypes} originType The type of packet that initialized this packet
 * @returns {ServerResponse}
 */
function createResponse(status, data, id, type, originType) { // this is a function for type stuff
    return {
        status: status,
        data: data,
        id: id,
        type: type,
        originType: originType,
        packetState: 0
    }
}

/**
 * 
 * @param {Object} command ServerPacket.command
 * @param {*} data The data to send
 * @param {Number} id Date.now()
 * @returns  {ServerPacket}
 */
function createServerPacket(command, data, id, sender) {
    return {
        command: command,
        data: data,
        id: id,
        packetState: 1,
        sender: sender
    }
}

/**
 * 
 * @param {Number} room The room to validate
 * @param {WS.WebSocket} sender The sender of the packet
 * @returns {Number} An http status code corresponding to the success of the connection
 */
function validateRoom(room, sender) {
    if (typeof room !== "number") return 400 // the room need to be a number
    if (sender.xRoom === room) return 304 // already connected to that room
    if (!Object.prototype.hasOwnProperty.call(ROOMS, String(room))) return 201 // room will be created
    
    // yeah probably fine then
    return 200
}

/**
 * 
 * @param {ClientPacket} data The packet to validate
 * @param {WS.WebSocket} sender The sender of the packet
 * @returns {Boolean}
 */
function validateIncomingPacket(data, sender) {
    let valid = 200
    if (typeof data?.command !== "object") return 400 // command must be included
    if (!data.command.type) return 400 // command must have a command type
    if (!Object.prototype.hasOwnProperty.call(PacketTypes, data.command.type)) return 400 // invalid packet

    if (data?.targets === undefined) return 400 // packet must have at least one target or null
    if (!data.id) return 400 // packet must have an id
    const targetsType = typeof data.targets
    if (!["object", "boolean"].includes(targetsType)) return 400 // targets must be an array, null, or true

    
    switch (data.command.type) {
        case "packet": {
            if (!data?.data) return 400 // you need to send data in the packet

            if (data.targets === true) {
                if (sender.xRoom === -1) return 400 // can't send packets to everyone in a room if you're not in a room
                break
            }
            if (data.targets === null || data.targets === true) break

            if (Array.isArray(data.targets)) { // it's a list of either rooms or users
                if (typeof data.targets[0] === "number") { // a list of rooms

                    for (let i = 0; i < data.targets.length; i++) {
                        if (typeof data.targets[i] !== "number") return 400 // all targets must be the same type, you can't mix and match
                        if (!Object.prototype.hasOwnProperty.call(ROOMS, data.targets[i])) return 404 // the room needs to exist, duh
                    }

                }
                else {

                    for (let i = 0; i < data.targets.length; i++) { // a list of users
                        if (typeof data.targets[i] !== "string") return 400 // all targets must be the same type, you can't mix and match
                        if (!Object.prototype.hasOwnProperty.call(USERS, data.targets[i])) return 404 // the user needs to exist, duh
                    }

                }

            }

            if (byteSize(data.data) > MAXPACKETSIZE) return 413 // too thicc
            break;
        }

        case "room": {
            const roomValid = validateRoom(data.targets[0], sender)
            if (roomValid >= 300) return roomValid // if there was an error here return it
            valid = roomValid // otherwise use this as the validity
            
            // yeah probably fine then
            break;
        }

        case "username": { // todo: this might introduce a race condition, maybe account for that?
            if (typeof data.command?.meta !== "string") return 400 // you need to provide a username to set, must be a string
            if (Object.prototype.hasOwnProperty.call(USERS, data.command.meta)) return 409 // username taken
            if (byteSize(data.command.meta) > MAXUSERNAMESIZE) return 413 // too thicc

            // probably fine
            break
        }

        default: {
            if (LOGGING) console.error("Unimplemented packet type " + data.command.type)
            return 501 // whoopsies i frogot to implement it
        }
    }

    return valid
}

wss.on("connection", (ws, req) => {
    ws.isAlive = true
    ws.xRoom = -1 // not connected to a room. x(someName) denotes a non standard websocket value.
    ws.xUsername = crypto.randomUUID() // generate a uuid we can use to reference this connection until they set a username
    USERS[ws.xUsername] = ws
    ws.on("error", (event) => { if (LOGGING) console.error(event) })
    ws.on("pong", () => { ws.isAlive = true })
    ws.on("close", (code, reason) => {
        if (LOGGING) console.log(`Closed connection to ${ws.xUsername} with code ${code} and reason "${reason}"`)
        delete USERS[ws.xUsername]
        if (ws.xRoom !== -1) popIndex(ROOMS[ws.xRoom].connections, ROOMS[ws.xRoom].connections.indexOf(ws.xUsername))
    })
    
    if (LOGGING) console.log("connection from url ", req.url)
    const url = new URL(`https://localhost:${port}` + req.url)
    if (url.searchParams.has("roomid")) {
        const room = Number(url.searchParams.get("roomid")) // get the room and cast it to a number
        if (LOGGING) console.log("Recieved request to initially connect to room " + String(room))
        const roomValid = validateRoom(room, ws)
        if (roomValid >= 300 && ws.OPEN) return ws.send(JSON.stringify(createResponse(roomValid, null, null, ResponseTypes.validate, PacketTypes.room))) // if the room is invalid send an error and exit the function
        

        if (!Object.prototype.hasOwnProperty(ROOMS,room)) ROOMS[room] = {
            connections: [],
            startTime: Date.now()
        }
        ROOMS[room].connections.push(ws.xUsername)
        ws.xRoom = room
        ws.send(JSON.stringify(createResponse(roomValid, null, null, ResponseTypes.validate, PacketTypes.room)))
        if (LOGGING) console.log("Connected client to initial room")
    }


    ws.on("message", (event) => {
        /**
         * @type {ClientPacket}
         */
        let data
        try {
            data = JSON.parse(event)
        }
        catch {
            if (LOGGING) console.error("Invalid message")
        }
        if (LOGGING) console.log("recieved message with data", data)
        const valid = validateIncomingPacket(data, ws)
        if (valid >= 300) return ws.send(JSON.stringify(createResponse(valid, null, data?.id, "validate", data?.command?.type ?? "INVALID"))) // errored, send a response and return

        switch (data.command.type) {
            case "packet": {
                if (Array.isArray(data.targets)) {
                    if (typeof data.targets[0] == "number") { // array of rooms   
                        data.targets.forEach((room) => {
                            ROOMS[room].connections.forEach((connection) => connection.send(
                                JSON.stringify(
                                    createServerPacket({type: PacketTypes.packet, meta: null}, data.data, data.id, ws.xUsername)
                                )
                            )) // go through each connection in the room and forward the packet
                        })
                    }
                    else { // array of users
                        data.targets.forEach((connection) => connection.send(
                            JSON.stringify(
                                createServerPacket({type: PacketTypes.packet, meta: null}, data.data, data.id, ws.xUsername)
                            )
                        )) // go through each user and forward the packet
                    }
                }

                else { // data.targets === true, which means forward to everyone in the current room
                    ROOMS[ws.xRoom].connections.forEach((connection) => USERS[connection].send(JSON.stringify(createServerPacket({type: PacketTypes.packet, meta: null}, data.data, data.id, ws.xUsername)))) // go through each connection in the user's room and forward the packet
                }
                
                break;
            }
            
            case "room": {
                if (ws.xRoom !== -1) popIndex(ROOMS[ws.xRoom].connections,ROOMS[ws.xRoom].connections.indexOf(ws.xUsername)) // remove the user from the room they're currently connected to
                ws.xRoom = data.targets[0]
                if (!Object.prototype.hasOwnProperty(ROOMS,data.targets[0])) ROOMS[data.targets[0]] = {
                    connections: [],
                    startTime: Date.now()
                }

                ROOMS[data.targets[0]].connections.push(ws.xUsername)
                ws.send(JSON.stringify(createResponse(valid, null, data.id, ResponseTypes.validate, data.command.type)))
                break;
            }

            case "username": {
                ROOMS[ws.xRoom].connections[ROOMS[ws.xRoom].connections.indexOf(ws.xUsername)] = data.command.meta
                delete USERS[ws.xUsername]
                ws.xUsername = data.command.meta
                USERS[data.command.meta] = ws
                ws.send(JSON.stringify(createResponse(valid, null, data.id, ResponseTypes.validate, data.command.type)))
                break;
            }
        }
    })
})

const keepAliveInterval = setInterval(function ping() {
    wss.clients.forEach((ws) => {
        if (ws.isAlive === false) return ws.terminate()
        if (LOGGING) console.log("Sent keepalive packet to " + ws.xUsername)
        ws.isAlive = false
        ws.ping() // websocket clients automatically return pongs, which will trigger the ws.on("pong") event.
        ws.send(JSON.stringify(createServerPacket({
                type: PacketTypes.userlist,
                meta: null
            },
            Object.values(USERS).map((user) => user.xUsername), 
            Date.now(),
            null
        )))
    })
}, KEEPALIVETIME)

wss.on("close", () => {
    if (LOGGING) console.error("connection closed")
    clearInterval(keepAliveInterval)
})

/**
 * @exports { ClientPacket, ServerPacket, ClientResponse, ServerResponse }
 */
module.exports = { ResponseTypes, PacketTypes, PacketStates, port }
console.log("Websocket server now running on ws://localhost:" + String(port))