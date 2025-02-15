const WS = require("ws")
// const { PacketTypes, ResponseTypes, port } = require("../index.js")
const client = new WS.WebSocket("ws://localhost:1958"/* + String(port)*/)
let successes = 0
console.log(client.url)
const INITIALCONNECTION = new URL(client.url).searchParams.has("roomid")
let NUMTESTSOFFSET = Number(INITIALCONNECTION)
let UUID

function setUsername(name) {
    if (client.OPEN) client.send(JSON.stringify({
        command: {
            type: "username",//PacketTypes.username,
            meta: null
        },
        targets: null,
        data: name,
        id: Date.now()
    }))
}

function connectToRoom(room) {
    if (client.OPEN) client.send(JSON.stringify({
        command: {
            type: "room",//PacketTypes.room,
            meta: null
        },
        targets: [room],
        data: null,
        id: Date.now()
    }))
}

function requestInfo() {
    if (client.OPEN) client.send(JSON.stringify({
        command: {
            type: "info",
            meta: null
        },
        targets: null,
        data: null,
        id: Date.now()
    }))
}

function authenticate(uuid, token) {
    if (client.OPEN) client.send(JSON.stringify({
        command: {
            type: "auth",
            meta: null
        },
        targets: null,
        data: {
            uuid: uuid,
            token: token
        },
        id: Date.now()
    }))
}

const tests = [
    () => { console.log("authenticating and setting username..."); authenticate("e1b5d77b-a23e-47a5-ad5b-62b99ce92e69","36cccd0b2d77dcb7f21840424955abd61fa0f07c")},
    () => { console.log("connecting to room..."); connectToRoom(1234) },
    // () => { console.log("setting username..."); setUsername(String(Math.round(Math.random()* 250))) },
    () => {
        console.log("sending dummy packet...")
        sendPacket({
            hello: "world",
            ohio: "rizzler"
        }, true)
    },
    () => { console.log("requesting client info..."); requestInfo()},
    //() => { console.log("attempting room change(this should fail)..."); connectToRoom(4321); }
]
const numTests = tests.length


function sendPacket(data, targets) {
    if (client.OPEN) client.send(JSON.stringify({
        command: {
            type: "packet",//PacketTypes.packet,
            meta: null
        },
        targets: targets,
        data: data,
        id: Date.now()
    }))
}

client.on("error", console.error)
client.on("open", () => {
    heartbeat()
    if (!INITIALCONNECTION && client.OPEN) tests.shift()()
})

function heartbeat() {
  clearTimeout(this.pingTimeout);
  
  client.pingTimeout = setTimeout(() => {
    console.error("Terminating connection due to server not responding...")
    client.terminate();
  }, 30000 + 1000);
}

client.on('ping', heartbeat);
client.on('close', function clear() {
    console.error("connection closed")
    clearTimeout(this.pingTimeout);
});

client.on("message", (rawData) => {
    /** @type {import("../index.js").ServerResponse} */
    const data = JSON.parse(rawData)
    switch (data.packetState) {
        case 0: { // server response to a packet we sent
            switch (data.originType) {
                case "room": {
                    if (data.status >= 300) {
                        console.error("Failed to connect to room, recieved response", data)
                    }
                    else {
                        console.log("connected to room successfully with response", data)
                        successes++
                    }
                    break;
                }
                case "username": {
                    if (data.status >= 300) {
                        console.error("Failed to set username, recieved response", data)
                    }
                    else {
                        console.log("set username successfully with response", data)
                        successes++
                    }
                    break;
                }
                case "packet": {
                    if (data?.status >= 300) {
                        console.log("packet sent unsuccessfully with response", data)
                    }
                    else {
                        // successful packet would be a data.packetState of 1 and a data.command.type of "packet", see below.
                    }
                    
                    break
                }

                case "INVALID": {
                    console.error("A packet was sent with an invalid type or something, recieved response", data)
                    break;
                }

                case "info": {
                    successes++
                    console.log("Recieved client info:",data)
                    break;
                }

                case "auth": {
                    if (data?.status >= 300) {
                        console.error("Failed to authenticate with response", data)
                    }
                    else {
                        successes++
                        console.log("Successfully authenticated with response", data)
                    }

                    break;
                }

                default: {
                    console.error("Invalid response packet recieved!", data)
                }
            }

            break
        }
        
        case 1: { // the server is sending a packet not initialized by us
            switch (data.command.type) {
                case "packet": {
                    successes++
                    console.log("Recieved packet from server", data)
                    break;
                }
                case "userlist": {
                    console.log("Recieved userlist from server", data)
                    break;
                }

                case "uuid": {
                    successes++
                    NUMTESTSOFFSET++
                    console.log("recieved uuid with packet", data)
                    UUID = data.data

                    console.log(`\nThis client's UUID is ${UUID}\n`)
                    break;
                }

                default: {
                    console.error("Invalid server packet recieved!",data)
                }
            }

            break;
        }

        default: {
            console.error("Recieved invalid packet!", data)
        }
    }

    if (data?.command?.type !== "userlist" && tests.length > 0) tests.shift()() // this is probably some of the freakiest syntax i have ever used.
    else if (tests.length < 1 && data?.command?.type !== "userlist") console.log(`\n\nTesting completed with ${successes}/${numTests + NUMTESTSOFFSET} tests successful`)
})