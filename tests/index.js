const WS = require("ws")
// const { PacketTypes, ResponseTypes, port } = require("../index.js")
const client = new WS.WebSocket("ws://localhost:1958"/* + String(port)*/)
let successes = 0


function setUsername(name) {
    if (client.OPEN) client.send(JSON.stringify({
        command: {
            type: "username",//PacketTypes.username,
            meta: name
        },
        targets: null,
        data: null,
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
const tests = [
    () => { console.log("connecting to room..."); connectToRoom(1295) },
    () => { console.log("setting username..."); setUsername("skibidi toilet") },
    () => {
        console.log("sending dummy packet...")
        sendPacket({
            hello: "world",
            ohio: "rizzler"
        }, true)
    }
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
    setTimeout(() => {
        tests[0]()
    }, 35)
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
                    numTests++
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
    else if (tests.length < 1 && data?.command?.type !== "userlist") console.log(`\n\nTesting completed with ${successes}/${numTests} tests successful`)
})