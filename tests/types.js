const WS = require("ws")
// const { PacketTypes, ResponseTypes, port } = require("../index.js")
const client = new WS.WebSocket("ws://localhost:1958"/* + String(port)*/)

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
    setTimeout(() => {
        connectToRoom(1125)
        console.log("connecting to room...")
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
            console.log("packet sent successfully with response", data)
            console.log("Tests completed successfully")
            break
        }
    }
})