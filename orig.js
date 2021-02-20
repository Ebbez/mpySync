const serialport = require('serialport')
const readline = require('readline')
const fs = require('fs')
const path = require('path')

const readlineparser = new serialport.parsers.Readline()
const rli = readline.createInterface({
    input: process.stdin,
    output: process.stdout
})

const prompt = (question) => {return new Promise((res, rej) => {rli.question(question, res)})}
const request = (con, commands) => {return new Promise((res, rej) => {
    con.write(commands)
    
    startOff = (commands.match(/\r\n/g) || []).length
    care = true
    lastData = ""
    dataBuf = ""

    const specificListener = (data) => {
        data = data.toString()


        if (care) {
            dataBuf += data
            if ((dataBuf.match(/\r\n/g) || []).length == startOff) {
                lastData += dataBuf.split('\r\n').splice(startOff).join('\r\n')
                dataBuf = ""
                care = false
            }
        } else {
            lastData += data
            occurIndex = lastData.indexOf(">>>")
            if (occurIndex != -1) {
                lastData = lastData.substring(0, occurIndex)
                con.removeListener('data', specificListener)
                res(lastData)
            }
        }
    }

    con.on('data', specificListener)
})}

const execTerminalCommand = (comm, con) => {
    con.write(comm + "\r\n")
    terminal(con)
}

const terminal = (con) => {
    setTimeout(() => {
        rli.question("mpySync> ", (response) => {
            execTerminalCommand(response, con)
        })
    }, 1000)
}

(async () => {
    var port = await prompt("Port [COM6]: ") || "COM6"
    var tbaudRate = parseInt(await prompt("Baud rate [115200]: ")) || 115200
    var syncFolder = await prompt("Sync folder [./ESP32-sync]: ") || "./ESP32-sync"

    const con = new serialport(port, {baudRate: tbaudRate})

    // Just loggin
    con.pipe(readlineparser)
    readlineparser.on('data', (data) => {
        if (data.startsWith(">>>")) return
        console.log(data)
    })

    await request(con, "\x03print('mpySync has successfully integrated with MicroPython.')\r\n\r\n")

    var files = JSON.parse((await request(con, "import os\r\nos.listdir()\r\n")).replace(/'/g, '"'))

    for (var i = 0; i < files.length; i++) {
        console.log(files[i])
        var fileContent = await request(con, "f = open('" + files[i] + "', 'r')\r\nf.read()\r\n")
        fileContent = JSON.parse('"' + fileContent.substring(1, fileContent.length - 3).replace(/"/g, "\\\"") + '"')

        fs.writeFileSync(path.join(process.cwd(), syncFolder, files[i]), fileContent)
    }

    fs.watch(path.join(process.cwd(), syncFolder), (ev, filename) => {
        console.log("---------------------mpySync---------------------")
        console.log("Detected a change of " + path.join(process.cwd(), syncFolder, filename))
        console.log("Writing new version...")
        if (fs.existsSync(path.join(process.cwd(), syncFolder, filename))) {
            newVersion = fs.readFileSync(path.join(process.cwd(), syncFolder, filename))
            con.write("f = open('" + filename + "', 'w')\r\nf.write('" + newVersion.toString().replace(/'/g, "\\'").replace(/\r\n/g, "\\r\\n") + "')\r\nf.close()\r\n")
        } else {
            con.write("import os\r\nos.remove('" + filename + "')\r\n")
        }
        console.log("\r\nSoft resetting the micropython board")
        con.write("import sys\r\nsys.exit()\r\n")
        con.drain((err) => {
            if (err) throw err;
        })
    })
    terminal(con)

})().catch(err => {
    console.log(err)
})