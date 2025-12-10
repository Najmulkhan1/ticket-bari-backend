const express = require("express");
const cors = require("cors");
const app = express();
const dotenv = require("dotenv"); // dotenv
dotenv.config();
// mongodb connection
const { MongoClient, ServerApiVersion } = require('mongodb');


// middleware
app.use(cors());
app.use(express.json());

const port = process.env.PORT || 3000;


const uri = process.env.MONGODB_URI;
// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});


const run = async () => {
    try{
        await client.connect();

        const db = client.db("ticket-bari");
        const usersCollection = db.collection("users")
        const ticketsCollection = db.collection('tickets')

        // user related api
    
        app.post('/users', async(req, res) => {
            const user = req.body
            user.role = 'user'
            user.createdAt = new Date()

            const email = user.email
            const userExist = await usersCollection.findOne({email})
            if(userExist){
                return res.send({message: 'User already exists'})
            }

            const result = await usersCollection.insertOne(user)
            res.send(result)
        })

        // ticket related api
        app.post('/tickets', async(req, res) => {
            const ticket = req.body
            ticket.createdAt = new Date()
            ticket.status = 'pending'

            const result = await ticketsCollection.insertOne(ticket)
            res.send(result)
        })

        app.get('/my-tickets', async(req,res) => {
            const email = req.query.email
            const query = {email: email}
            const result = await ticketsCollection.find(query).toArray()
            res.send(result)
        })




        await client.db("admin").command({ping: 1});
        console.log("MongoDB connected");
    }
    finally{
        // await client.close();
    }
}

run().catch(console.dir);

app.get('/', (req, res) => {
    res.send('Hello World!')
})

app.listen(port, () => {
    console.log(`Example app listening on port ${port}`)
})
