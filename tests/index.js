const WS = require("ws")
// const { PacketTypes, ResponseTypes, port } = require("../index.js")
const client = new WS.WebSocket("ws://localhost:1958?room=1125"/* + String(port)*/)

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
    /*setTimeout(() => {
        connectToRoom(1125)
        console.log("connecting to room...")
    }, 35)*/
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
                    console.log("connected to room successfully with response", data)
                    setUsername("skibidi toilet")
                    break;
                }
                case "username": {
                    console.log("set username successfully with response", data)
                    sendPacket({
                        hello: "world",
                        ohio: "rizzler"
                    }, true)
                    break;
                }
                case "packet": {
                    console.log("packet sent unsuccessfully with response", data)
                    console.log("Tests completed successfully")
                    break
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

})