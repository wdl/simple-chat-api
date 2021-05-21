const express = require('express')
const cors = require('cors')

const mysql = require('mysql2/promise')
const jwt = require('jsonwebtoken')

const fs = require('fs')
const crypto = require('crypto');
const { resolve } = require('path')

const app = express()

app.use(express.json())
app.use(cors({
    origin: 'https://app.chat.pedo.me'
}))

const config = JSON.parse(fs.readFileSync('config.json').toString('utf-8'))

app.put('/sync', async function (req, res) {
    try {
        if(!req.headers.token) {
            throw ({statusCode: 401, message: 'Token not found'})
        }
        const token = req.headers.token
        const user = await new Promise((resolve, reject) => {
            jwt.verify(token, config.jwt.secret, (err, decoded) => {
                if(err) reject({statusCode: 401, message: err.toString()})
                resolve(decoded)
            })
        })

        if(!user.idx || !user.nick || !user.nicknameColor || !user.profileImage) {
            throw ({statusCode: 400, message: 'Abnormal Token'})
        }

        const userHash = crypto.createHmac('sha1', config.user.salt + user.idx).digest('hex')

        const connectionPool = await mysql.createPool({connectionLimit:10, host:config.database.host, user:config.database.user, password:config.database.password, database:config.database.database})

        const queryPush = {
            statement: `INSERT INTO ct_user (hash, nick, nicknameColor, profileImage)
                        VALUES (?, ?, ?, ?)
                        ON DUPLICATE KEY UPDATE
                            nick = VALUES(nick),
                            nicknameColor = VALUES(nicknameColor),
                            profileImage = VALUES(profileImage)`,
            value: [userHash, user.nick, user.nicknameColor, user.profileImage]
        }
        const [rowsQueryPush, fieldsQueryPush] = await connectionPool.execute(queryPush.statement, queryPush.value)
        if(!rowsQueryPush?.affectedRows) {
            throw ({statusCode: 400, message: 'Bad parameters'})
        }

        const queryPull = {
            statement: `SELECT hash, nick, nicknameColor, profileImage FROM ct_user`
        }
        const [rowsQueryPull, fieldsQueryPull] = await connectionPool.execute(queryPull.statement)

        const queryGet = {
            statement: `SELECT no, writer, type, data, date FROM ct_data ORDER BY no DESC LIMIT 0, 100`
        }
        const [rowsQueryGet, fieldsQueryGet] = await connectionPool.execute(queryGet.statement)

        connectionPool.end()

        res.json({
            success: true,
            data: {
                chatInfo: {
                    title: config.chat.title
                },
                userInfo: {
                    me: userHash,
                    users: rowsQueryPull
                },
                comments: rowsQueryGet
            }
        })
    } catch(e) {
        console.log(e)
        res.status(e.statusCode || 500).json({ success: false, error: e.message || e })
    }
})

app.get('/:last', async function (req, res) {
    try {
        if(!req.headers.token) {
            throw ({statusCode: 401, message: 'Token not found'})
        }
        const token = req.headers.token
        await new Promise((resolve, reject) => {
            jwt.verify(token, config.jwt.secret, (err) => {
                if(err) reject({statusCode: 401, message: err.toString()})
                resolve()
            })
        })

        if(!req.params.last) {
            throw ({statusCode: 400, message: 'Bad parameter'})
        }
        const last = req.params.last

        let waitTime = 500
        if(req.query?.wt === 'max') {
            waitTime = 5000
        }

        const connectionPool = await mysql.createPool({connectionLimit:10,host:config.database.host, user:config.database.user, password:config.database.password, database:config.database.database})

        const queryGet = {
            statement: `SELECT no, writer, type, data, date FROM ct_data WHERE no > ? ORDER BY no DESC`,
            value: [last]
        }

        let [rowsQueryGet, fieldsQueryGet] = await connectionPool.execute(queryGet.statement, queryGet.value)
        
        if(rowsQueryGet.length === 0) {
            for(let cnt = 0; cnt < 36; cnt++) {
                rowsQueryGet = await new Promise ((resolve) => {
                    setTimeout(async () => {
                        const [rowsQueryGetUnit, fieldsQueryGetUnit] = await connectionPool.execute(queryGet.statement, queryGet.value)
                        resolve(rowsQueryGetUnit)
                    }, waitTime)
                })
                if(rowsQueryGet.length > 0) {
                    break
                }
                if(waitTime < 5000) { waitTime = waitTime + 125 }
            }
        }

        connectionPool.end()
        
        res.json({
            success: true,
            data: {
                comments: rowsQueryGet
            }
        })
    } catch(e) {
        console.log(e)
        res.status(e.statusCode || 500).json({ success: false, error: e.message || e })
    }
})

app.post('/', async function (req, res) {
    try {
        if(!req.headers.token) {
            throw ({statusCode: 401, message: 'Token not found'})
        }
        const token = req.headers.token
        const user = await new Promise((resolve, reject) => {
            jwt.verify(token, config.jwt.secret, (err, decoded) => {
                if(err) reject({statusCode: 401, message: err.toString()})
                resolve(decoded)
            })
        })

        if(!user.idx) {
            throw ({statusCode: 400, message: 'Abnormal Token'})
        }

        const userHash = crypto.createHmac('sha1', config.user.salt + user.idx).digest('hex')

        if(!req.body.type || !req.body.data) {
            throw ({statusCode: 400, message: 'Insufficient parameters'})
        }
        const type = req.body.type
        const data = req.body.data

        const connectionPool = await mysql.createPool({connectionLimit:10,host:config.database.host, user:config.database.user, password:config.database.password, database:config.database.database})

        const queryPost = {
            statement: `INSERT INTO ct_data (writer, type, data)
                        VALUES (?, ?, ?)`,
            value: [userHash, type, data]
        }

        let [rowsQueryPost, fieldsQueryPost] = await connectionPool.execute(queryPost.statement, queryPost.value)
        if(!rowsQueryPost?.affectedRows) {
            throw ({statusCode: 400, message: 'Bad parameters'})
        }

        connectionPool.end()

        res.json({
            success: true,
            data: {
                commentInsertNo: rowsQueryPost.insertId 
            }
        })
    } catch(e) {
        console.log(e)
        res.status(e.statusCode || 500).json({ success: false, error: e.message || e })
    }
})
 
app.listen(12041)