const KEEPALIVETIME = 10000 // in milliseconds, also used to update the userlist
const MAXPACKETSPERTIME = 750 // maximum number of packets in KEEPALIVETIME, this default value is 75/second
const MAXPACKETSIZE = 2500  // in bytes
const MAXUSERNAMESIZE = 200 // in bytes
const port = 1958 // port  the server runs on
const LOGGING = false // whether to log debug stuff
const ALLOWUSERNAMECHANGE = false; // if this is set to false, only allow one username set(this doesn't apply if the setting fails)
const ALLOWROOMCHANGE = false; // if this is set to false, do not allow clients to set their room and only allow the initial connection.
const ALLOWCROSSROOMMESSAGING = false; // if this is set to false, do not allow targets of room ids.
const AUTH = false // if this is enabled, do not allow room connections until the user has authenticated
const AUTHURL = "http://localhost:9846/v1/auth-token" // the url to use when authenticating

/*
POST AUTHURL
Body: {
    uuid: UUID,
    token: Token
}

Response:
Body: {
    valid: Boolean
}
*/


const WS = require("ws")
const crypto = require("crypto")
let ROOMS = {}
let USERS = {}

const wss = new WS.WebSocketServer({
    port: port
})


/**
 * 
 * @param {String} uuid The uuid to check
 * @param {String} token The token to check
 * @returns {Promise<Boolean>} Whether the token is valid
 */
function authenticate(uuid, token) {
    return new Promise(async (resolve, reject) => {
        try {
            const f = await fetch(AUTHURL, {
                method: "POST",
                body: JSON.stringify({
                    uuid: uuid,
                    token: token
                }),
                headers: {
                    "Content-Type": "application/json"
                }
            })
            if (!f) {
                if (LOGGING) console.error(`Failed to authenticate ${uuid} with token ${token}`)
                return resolve({ result: false, status: f.status })
            }
            const res = await f.json()
            
            return resolve({ result: !!res?.result, status: f.status}) // freaky
        }
        catch (error) {
            if (LOGGING) console.error("Failed to authenticate:", error)
            return resolve({ result: false, status: 500 })
        }
    })
}

/*
command.type values. how do i do this with jsdoc.

"username" - Requests a username to be set
data: String for the username

response: 
validate, if the username is already taken or something else, respond with an error code. otherwise 200

"packet" - A packet which will be forwarded to the provided targets.
response: forward/packet, any

"room" - Connect to the first room in the provided target list, and create it if it doesn't exist
response: validate, a response code based on whether that connection happened

"info" - Request client info. Doesn't need any data or targets, client info is in the response's data.
response's data:
uuid: UUID
username: username
room: roomID

"auth" - Similar for username, except this is priviledged.
data:
uuid - String
token - String
response: data is a boolean of whether the authentication was valid.

on connection user is sent a packet containing a username in the data and a type of -1.
*/

/**
 * @readonly
 * @enum {String} 
 */
const ResponseTypes = {
    forward: "forward",
    validate: "validate",
    info: "info"
}
/**
 * @readonly
 * @enum {String}
 */
const PacketTypes = {
    username: "username",
    packet: "packet",
    room: "room",
    userlist: "userlist",
    uuid: "uuid",
    info: "info",
    auth: "auth"
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
 * @param {Room} room The room to generate a user list ofr
 * @returns {String}
 */
function userlist(room) {
    return JSON.stringify(createServerPacket({
            type: PacketTypes.userlist,
            meta: null
        },
        room.connections.map((id) => { return {username: USERS[id].xUsername, uuid: USERS[id].xUUID} }), 
        Date.now(),
        null
    ))
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

    if (byteSize(data?.data) > MAXPACKETSIZE) return 413 // too thicc
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
                    if (!ALLOWCROSSROOMMESSAGING) return 403 // don't allow cross room messaging
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

            break;
        }

        case "room": {
            if (sender.xRoom !== -1 && !ALLOWROOMCHANGE) return 403 // not allowed to change room
            if (!sender.xUUID && AUTH) return 401
            const roomValid = validateRoom(data.targets[0], sender)
            if (!data?.id) return 400 // needs to have a way to respond to the packet
            if (roomValid >= 300) return roomValid // if there was an error here return it
            valid = roomValid // otherwise use this as the validity
            
            // yeah probably fine then
            break;
        }

        case "username": { // todo: this might introduce a race condition, maybe account for that?
            if (!data?.id) return 400 // needs to have a way to respond to the packet
            if (typeof data?.data !== "string") return 400 // you need to provide a username to set, must be a string\
            if (Object.prototype.hasOwnProperty.call(USERS, data.data)) return 409 // username taken
            if (byteSize(data.data) > MAXUSERNAMESIZE) return 413 // too thicc
            if (sender.xUsername !== sender.xUUID && !ALLOWUSERNAMECHANGE) return 423 // already set their username

            // probably fine
            break
        }

        case "info": {
            if (!data?.id) return 400
            break // this doesn't need anything besides a packet id ¯\_(ツ)_/¯
        }

        case "auth": {
            if (!AUTH) return 423
            if (sender.xRoom !== -1) return 406
            if (!data?.data) return 400
            if (typeof data.data !== "object") return 400
            if (!Object.prototype.hasOwnProperty.call(data.data, "uuid")) return 400
            if (!Object.prototype.hasOwnProperty.call(data.data, "token")) return 400
            if (typeof data.data.uuid  !== "string") return 400
            if (typeof data.data.token !== "string") return 400

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
    ws.xUsername = AUTH ? null : crypto.randomUUID() // generate a uuid we can use to reference this connection until they set a username
    ws.xUUID = AUTH ? null : ws.xUsername // initial username is the uuid
    ws.xPackets = 0 // number of packets sent in the given time frame
    ws.xRateLimited = false


    USERS[ws.xUUID] = ws
    ws.on("error", (event) => { if (LOGGING) console.error(event) })
    ws.on("pong", () => { ws.isAlive = true })
    ws.on("close", (code, reason) => {
        if (LOGGING) console.log(`Closed connection to ${ws.xUsername}(${ws.xUUID}) with code ${code} and reason "${reason}"`)
        delete USERS[ws.xUUID]
        if (ws.xRoom !== -1) popIndex(ROOMS[ws.xRoom].connections, ROOMS[ws.xRoom].connections.indexOf(ws.xUUID))
    })
    
    if (LOGGING) console.log("connection from url ", req.url)
    const url = new URL(`https://localhost:${port}` + req.url)
    if (url.searchParams.has("roomid")) {
        if (AUTH) {
            ws.send(JSON.stringify(createResponse(403, null, null, ResponseTypes.validate, PacketTypes.room))) // if auth mode is enabled, require the user to authenticate before joining a room
        }
        else {
            const room = Number(url.searchParams.get("roomid")) // get the room and cast it to a number
            if (LOGGING) console.log("Recieved request to initially connect to room " + String(room))
            const roomValid = validateRoom(room, ws)
            if (roomValid >= 300 && ws.OPEN) return ws.send(JSON.stringify(createResponse(roomValid, null, null, ResponseTypes.validate, PacketTypes.room))) // if the room is invalid send an error and exit the function
            
            if (!Object.prototype.hasOwnProperty.call(ROOMS,String(room))) ROOMS[room] = {
                connections: [],
                startTime: Date.now()
            }
            const ulist = userlist(ROOMS[room])
            ROOMS[room].connections.forEach((con) => {
                USERS[con].send(ulist)
            })
            ROOMS[room].connections.push(ws.xUUID)
    
            ws.xRoom = room
            ws.send(JSON.stringify(createResponse(roomValid, null, null, ResponseTypes.validate, PacketTypes.room)))
    
            if (LOGGING) console.log("Connected client to initial room")
        }
    }
    if (ws.OPEN && !AUTH) ws.send(JSON.stringify(createServerPacket({ type: PacketTypes.uuid, meta: null }, ws.xUUID, Date.now(), null))) // send the client their uuid

    ws.on("message", async (event) => {
        ws.xPackets++
        if (ws.xPackets > MAXPACKETSPERTIME && ws.OPEN && !ws.xRateLimited) { // ratelimiting, this is before data parsing to avoid unnecessary resource usage
            ws.send(JSON.stringify(createResponse(429, null, null, "validate", null)))
            ws.xRateLimited = true
        }
        
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
        try {
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
                                        createServerPacket({type: PacketTypes.packet, meta: data?.command?.meta}, data.data, data.id, ws.xUUID)
                                    )
                                )) // go through each connection in the room and forward the packet
                            })
                        }
                        else { // array of users
                            data.targets.forEach((connection) => USERS[connection].send(
                                JSON.stringify(
                                    createServerPacket({type: PacketTypes.packet, meta: data?.command?.meta}, data.data, data.id, ws.xUUID)
                                )
                            )) // go through each user and forward the packet
                        }
                    }

                    else { // data.targets === true, which means forward to everyone in the current room
                        if (LOGGING) console.log("Forwarding packet to users", ROOMS[ws.xRoom].connections)
                        ROOMS[ws.xRoom].connections.forEach((connection) => USERS[connection].send(JSON.stringify(createServerPacket({type: PacketTypes.packet, meta: data?.command?.meta}, data.data, data.id, ws.xUUID)))) // go through each connection in the user's room and forward the packet
                    }
                    
                    break;
                }
                
                case "room": {
                    if (ws.xRoom !== -1) popIndex(ROOMS[ws.xRoom].connections,ROOMS[ws.xRoom].connections.indexOf(ws.xUUID)) // remove the user from the room they're currently connected to
                    ws.xRoom = data.targets[0]
                    if (!Object.prototype.hasOwnProperty(ROOMS,data.targets[0])) ROOMS[data.targets[0]] = {
                        connections: [],
                        startTime: Date.now()
                    }
                    const ulist = userlist(ROOMS[data.targets[0]])
                    ROOMS[data.targets[0]].connections.forEach((con) => {
                        USERS[con].send(ulist)
                    })
                    ROOMS[data.targets[0]].connections.push(ws.xUUID)
                    ws.send(JSON.stringify(createResponse(valid, null, data.id, ResponseTypes.validate, data.command.type)))
                    break;
                }

                case "username": {
                    ws.xUsername = data.data
                    ws.send(JSON.stringify(createResponse(valid, null, data.id, ResponseTypes.validate, data.command.type)))
                    break;
                }

                case "info": {
                    ws.send(JSON.stringify(createResponse(valid, {
                        uuid: ws.xUUID,
                        username: ws.xUsername,
                        room: ws.xRoom
                    }, data.id, ResponseTypes.info, data.command.type)))
                    break;
                }

                case "auth": { // if auth mode is enabled you need to be in the home room(-1, invalid) so you don't mess with anything.
                    const a = await authenticate(data.data.uuid, data.data.token)
                    if (a.result) {
                        delete USERS[ws.xUUID]
                        USERS[data.data.uuid] = ws
                        ws.xUUID = data.data.uuid
                        ws.xUsername = data.data.uuid
                        ws.send(JSON.stringify(createResponse(a.status, a.result, data.id, ResponseTypes.validate, data.command.type)))
                        break;
                    }
                    else {
                        ws.send(JSON.stringify(createResponse(a.status, a.result, data.id, ResponseTypes.validate, data.command.type)))
                    }
                }
            }
        }

        catch (error) {
            console.error("Server failed to respond to packet with data and error", data, error)
            if (ws?.OPEN) {
                try { ws.send(JSON.stringify(createServerPacket({ type: "error", meta: null}, 500, Date.now(), null))) } // the sad
                catch { }
            }
        }
    })
})

const keepAliveInterval = setInterval(function ping() {
    if (LOGGING) console.log(`${Date.now()} - Keepalive tick`)
    wss.clients.forEach((ws) => {
        try {
            if (ws.isAlive === false) return ws.terminate()
            if (LOGGING) console.log("Sent keepalive packet to " + ws.xUsername)
            ws.isAlive = false
            ws.ping() // websocket clients automatically return pongs, which will trigger the ws.on("pong") event.
            if (ws.xPackets >= MAXPACKETSPERTIME*2) {
                if (LOGGING) console.warn(`Disconnected client ${ws.xUUID}(${ws.xUsername}) for exceeding ratelimit with ${ws.xPackets} in the given time.`)

                return ws.close(1008,"Ratelimit exceeded")
            }
            ws.xPackets = 0
            ws.xRateLimited = false
        }
        catch (error) {
            console.error("Failed on keepalive with error for client", error, ws)
        }
        
    
    })

    Object.values(ROOMS).forEach((room) => {
        const l = userlist(room)
        room.connections.forEach((id) => USERS[id].send(l)) 
        
        
    })
}, KEEPALIVETIME)

wss.on("close", () => {
    if (LOGGING) console.error("connection closed")
    clearInterval(keepAliveInterval)
})
process.on('SIGTERM', () => {
  // Clean up resources
  server.close(() => {
    process.exit(0);
  });
});

/**
 * @exports { ClientPacket, ServerPacket, ClientResponse, ServerResponse }
 */
module.exports = { ResponseTypes, PacketTypes, PacketStates, port }
console.log("Websocket server now running on ws://localhost:" + String(port))
