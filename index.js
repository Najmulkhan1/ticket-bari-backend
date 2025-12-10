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

const port = process.env.PORT || 5000;


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
