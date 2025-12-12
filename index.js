const express = require("express");
const cors = require("cors");
const app = express();
const dotenv = require("dotenv"); // dotenv
dotenv.config();
// mongodb connection
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);


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
    try {
        await client.connect();

        const db = client.db("ticket-bari");
        const usersCollection = db.collection("users")
        const ticketsCollection = db.collection('tickets')
        const bookingsCollection = db.collection('bookings')

        // user related api

        app.post('/users', async (req, res) => {
            const user = req.body
            user.role = 'user'
            user.createdAt = new Date()

            const email = user.email
            const userExist = await usersCollection.findOne({ email })
            if (userExist) {
                return res.send({ message: 'User already exists' })
            }

            const result = await usersCollection.insertOne(user)
            res.send(result)
        })

        // ticket related api

        app.get('/tickets', async (req, res) => {
            const result = await ticketsCollection.find().toArray()
            res.send(result)
        })

        app.get('/tickets/:id', async (req, res) => {
            const id = req.params.id
            const query = { _id: new ObjectId(id) }
            const result = await ticketsCollection.findOne(query)
            res.send(result)
        })


        app.post('/tickets', async (req, res) => {
            const ticket = req.body
            ticket.createdAt = new Date()
            ticket.status = 'pending'

            const result = await ticketsCollection.insertOne(ticket)
            res.send(result)
        })

        app.get('/my-tickets', async (req, res) => {
            const email = req.query.email
            const query = { email: email }
            const result = await ticketsCollection.find(query).toArray()
            res.send(result)
        })

        // booking related api
        app.get('/my-bookings', async (req, res) => {
            const email = req.query.email


            const pipeLine = [
                { $match: { email } },
                { $addFields: { ticketId: { $toObjectId: '$ticketId' } } },
                {
                    $lookup: {
                        from: 'tickets',
                        localField: 'ticketId',
                        foreignField: '_id',
                        as: 'ticket'
                    }
                },
                { $unwind: { path: '$ticket', preserveNullAndEmptyArrays: true } }
            ]

            const result = await bookingsCollection.aggregate(pipeLine).toArray()
            res.send(result)
        })


        app.post('/bookings', async (req, res) => {
            const booking = req.body
            booking.createdAt = new Date()
            // const ticketId = booking.ticketId
            // const qtyToBook = parseInt(booking.quantity)

            // const updatedTicket = await ticketsCollection.findOneAndUpdate(
            //     {
            //         _id: new ObjectId(ticketId),
            //         quantity: { $gte: qtyToBook }
            //     },
            //     {
            //         $inc: { quantity: -qtyToBook }
            //     },
            //     {
            //         returnDocument: 'after'
            //     }
            // )

            // if (!updatedTicket) {
            //     return res.status(400).send({
            //         error: "Not enough seats available!"
            //     });
            // }

            const result = await bookingsCollection.insertOne(booking)
            res.send({ message: 'Booking successful', result })
        })

        app.patch('/bookings/:id', async (req, res) => {
            const id = req.params.id
            const updatedBooking = req.body
            const query = { _id: new ObjectId(id) }
            const result = await bookingsCollection.updateOne(query, { $set: updatedBooking })
            res.send(result)
        })

        app.get('/vendor/bookings-request', async (req, res) => {
            const vendorEmail = req.query.vendorEmail

            const pipeLine = [
                { $match: { vendorEmail } },
                { $addFields: { ticketId: { $toObjectId: '$ticketId' } } },
                {
                    $lookup: {
                        from: 'tickets',
                        localField: 'ticketId',
                        foreignField: '_id',
                        as: 'ticket'
                    }
                },
                { $unwind: { path: '$ticket', preserveNullAndEmptyArrays: true } }
            ]
            const result = await bookingsCollection.aggregate(pipeLine).toArray()
            res.send(result)
        })


        // payment related api
        app.post('/create-checkout-session', async (req, res) => {
            const paymentInfo = req.body
            const session = await stripe.checkout.sessions.create({
                line_items: [
                    {
                        // Provide the exact Price ID (for example, price_1234) of the product you want to sell
                        price_data:{
                            currency: 'USD',
                            product_data: {
                                name: `Please pay for: ${paymentInfo.title}`,
                                
                            },
                            unit_amount: paymentInfo.amount * 100
                        },
                        quantity: 1,
                    },
                ],
                mode: 'payment',
                metadata: {
                    bookingId: paymentInfo.bookingId,
                },
                customer_email: paymentInfo.email,
                success_url: `${process.env.SITE_DOMAIN}/dashboard/payment-success`,
                cancel_url: `${process.env.SITE_DOMAIN}/dashboard/payment-failed`,
            });

            res.send({ url: session.url });
        });

       



        await client.db("admin").command({ ping: 1 });
        console.log("MongoDB connected");
    }
    finally {
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
