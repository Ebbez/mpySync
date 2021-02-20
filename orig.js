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

var remote, remoteTO = ["", ""]

const execTerminalCommand = (comm, con) => {
    con.write(comm + "\r\n")
    [remote, remoteTO] = terminal(con)
}

const terminal = (con) => {
    const ac = new AbortController()
    const signal = ac.signal

    var to = setTimeout(() => {
        rli.question("mpySync> ", {signal}, (response) => {
            execTerminalCommand(response, con)
        })
    }, 200) 

    return [ac, to]
}

(async () => {
    var port = await prompt("Port [COM6]: ") || "COM6"
    var tbaudRate = parseInt(await prompt("Baud rate [115200]: ")) || 115200
    var syncFolder = await prompt("Sync folder [./ESP32-sync]: ") || "./ESP32-sync"

    const con = new serialport(port, {baudRate: tbaudRate}, (err) => {
        if (err) throw err;
        else [remote, remoteTO] = terminal(con)
    })

    // Just loggin
    con.pipe(readlineparser)
    readlineparser.on('data', (data) => {
        if (data.startsWith(">>>")) return
        remote.abort()
        clearTimeout(remoteTO)
        console.log(data)
        var newRemote = terminal(con)
        remote = newRemote[0]
        remoteTO = newRemote[1]
    })

    await request(con, "\x03")
    await request(con, "\x03")
    await request(con, "\x03")
    await request(con, "print('mpySync has successfully hooked with MicroPython.')\r\n")

    var files = JSON.parse((await request(con, "import os\r\nos.listdir()\r\n")).replace(/'/g, '"'))

    for (var i = 0; i < files.length; i++) {
        console.log(files[i])
        var fileContent = await request(con, "f = open('" + files[i] + "', 'r')\r\nf.read()\r\n")
        fileContent = JSON.parse('"' + fileContent.substring(1, fileContent.length - 3).replace(/"/g, "\\\"") + '"')

        fs.writeFileSync(path.join(process.cwd(), syncFolder, files[i]), fileContent)
    }

    var writing = false
    fs.watch(path.join(process.cwd(), syncFolder), (ev, filename) => {
        if (!writing) {
            writing = true
            if (fs.existsSync(path.join(process.cwd(), syncFolder, filename))) {
                newVersion = fs.readFileSync(path.join(process.cwd(), syncFolder, filename))
                con.write("f = open('" + filename + "', 'w')\r\nf.write('" + newVersion.toString().replace(/'/g, "\\'").replace(/\r\n/g, "\\r\\n") + "')\r\nf.close()\r\n")
            } else {
                con.write("import os\r\nos.remove('" + filename + "')\r\n")
            }

            con.drain((err) => {
                if (err) throw err;
                writing = false
            })
        }
    })

})().catch(err => {
    console.log(err)
})