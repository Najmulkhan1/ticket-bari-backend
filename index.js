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
const crypto = require('crypto');


const admin = require("firebase-admin");

const serviceAccount = require("./ticket-bari-firebase-adminsdk-fbsvc-.json");

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
});


function generateTicketId() {
    const timestamp = Date.now();
    const random = crypto.randomBytes(3).toString('hex').toUpperCase();
    return `TCK-${timestamp}-${random}`;
}


// authentication
const verifyFBToken = async (req, res, next) => {
    const token = req.headers.authorization;

    if (!token) {
        return res.status(401).send({ message: 'Unauthorized' })
    }

    try {
        const idToken = token.split(' ')[1]
        const decoded = await admin.auth().verifyIdToken(idToken)
        console.log('decoded in the token', decoded);

        req.decoded = decoded.email
        next()


    } catch (error) {
        return res.status(401).send({ message: 'Unauthorized' })
    }
}


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
        const paymentsCollection = db.collection('payments')


        // middleware
        const verifyVendor = async (req, res, next) => {
            const email = req.decoded
            const user = await usersCollection.findOne({ email: email })
            if (user?.role !== 'vendor') {
                return res.status(403).send({ message: 'Forbidden access' })
            }
            next()
        }

        // user related api
        // admin
        app.get('/users', verifyFBToken, async (req, res) => {
            const search = req.query.search
            const query = {}

            if (search) {
                query.$or = [
                    { displayName: { $regex: search, $options: 'i' } },
                    { email: { $regex: search, $options: 'i' } },
                ]
            }

            const cursor = usersCollection.find(query).sort({ createdAt: -1 })
            const result = await cursor.toArray()
            res.send(result)

        })

        app.get('/users-profile/:email', async (req, res) => {
            const email = req.params.email
            const query = { email }

            const result = await usersCollection.findOne(query)
            res.send(result)
        })

        // User Profile Update API
        app.patch('/users-update/:email', async (req, res) => {
            const email = req.params.email;
            const filter = { email: email };
            const profile = req.body;


            const updateDoc = {
                $set: {
                    phone: profile.phone,
                    address: profile.address,
                    city: profile.city,
                    bio: profile.bio
                }
            };

            const options = { upsert: true };

            const result = await usersCollection.updateOne(filter, updateDoc, options);
            res.send(result);
        });



        app.get('/users/:email/role', async (req, res) => {
            const email = req.params.email;
            const query = { email }
            const user = await usersCollection.findOne(query);
            res.send({ role: user?.role || 'user' })
        })

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

        // admin
        app.patch('/users/role/:id', verifyFBToken, async (req, res) => {
            const id = req.params.id
            const updatedUser = req.body
            const query = { _id: new ObjectId(id) }
            const result = await usersCollection.updateOne(query, { $set: updatedUser })
            res.send(result)
        })

        // admin
        app.patch('/users/fraud/:id', verifyFBToken, async (req, res) => {
            const id = req.params.id
            const query = { _id: new ObjectId(id) }

            const user = await usersCollection.findOne(query)
            if (!user) {
                return res.status(404).send({ message: 'User not found' })
            }


            const updateRole = {
                $set: {
                    role: 'fraud'
                }
            }

            const updateUserResult = await usersCollection.updateOne(query, updateRole)


            const deleteTicketsResult = await ticketsCollection.deleteMany({ email: user.email }) //or use vendor id 

            res.send({ updateUserResult, deleteTicketsResult })
        })


        // ticket related api

        // admin show all tickets
        app.get('/tickets', verifyFBToken, async (req, res) => {

            const search = req.query.search
            const query = {}

            if (search) {
                query.$or = [
                    { title: { $regex: search, $options: 'i' } },
                    { email: { $regex: search, $options: 'i' } },
                ]
            }

            const result = await ticketsCollection.find(query).sort({ createdAt: -1 }).toArray()
            res.send(result)
        })

        app.get('/all-tickets', async (req, res) => {

            const query = { status: 'approved', quantity: { $gt: 0 } }

            const result = await ticketsCollection.find(query).sort({ createdAt: -1 }).toArray()
            res.send(result)
        })


        app.get('/tickets/:id', async (req, res) => {
            const id = req.params.id
            const query = { _id: new ObjectId(id) }
            const result = await ticketsCollection.findOne(query)
            res.send(result)
        })


        // vendor
        app.post('/tickets', verifyFBToken, verifyVendor, async (req, res) => {
            const ticket = req.body
            ticket.createdAt = new Date()
            ticket.status = 'pending'
            // const email = req.decoded.email  //verify token 
            const email = ticket.email

            const user = await usersCollection.findOne({ email: email })
            if (user?.role === 'fraud') {
                return res.status(403).send({ message: 'You are not allowed to create a ticket' })
            }

            const result = await ticketsCollection.insertOne(ticket)
            res.send(result)
        })

        // admin
        app.patch('/tickets/status/:id', verifyFBToken, async (req, res) => {
            const id = req.params.id
            const updatedTicket = req.body
            const query = { _id: new ObjectId(id) }
            const result = await ticketsCollection.updateOne(query, { $set: updatedTicket })
            res.send(result)
        })

        // vendor
        app.get('/my-tickets', verifyFBToken, verifyVendor, async (req, res) => {
            const email = req.query.email
            const query = { email: email }
            const result = await ticketsCollection.find(query).toArray()
            res.send(result)
        })

        // admin
        app.patch('/tickets/advertise/:id', async (req, res) => {
            const id = req.params.id
            const { isAdvertised } = req.body

            const filter = { _id: new ObjectId(id) }

            const updateDoc = {
                $set: {
                    isAdvertised: isAdvertised
                }
            }

            const result = await ticketsCollection.updateOne(filter, updateDoc)
            res.send(result)
        })


        // home page a advertised tickets show 

        app.get('/tickets-advertise', async (req, res) => {
            const query = { isAdvertised: true }
            const result = await ticketsCollection.find(query).toArray()
            res.send(result)
        })



        // booking related api
        app.get('/my-bookings', verifyFBToken, async (req, res) => {
            const email = req.query.email

            if (req.decoded !== email) {
                return res.status(403).send({ message: 'Forbidden access' })
            }


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
                { $unwind: { path: '$ticket', preserveNullAndEmptyArrays: true } },
                { $sort: { createdAt: -1 } }


            ]

            const result = await bookingsCollection.aggregate(pipeLine).toArray()
            res.send(result)
        })





        app.post('/bookings', verifyFBToken, async (req, res) => {
            const booking = req.body
            booking.createdAt = new Date()
            // const ticketId = booking.ticketId
            // const qtyToBook = parseInt(booking.quantity)

            // if (booking.status === 'paid') {
            //     const updatedTicket = await ticketsCollection.findOneAndUpdate(
            //         {
            //             _id: new ObjectId(ticketId),
            //             quantity: { $gte: qtyToBook }
            //         },
            //         {
            //             $inc: { quantity: -qtyToBook }
            //         },
            //         {
            //             returnDocument: 'after'
            //         }
            //     )

            //     if (!updatedTicket) {
            //         return res.status(400).send({
            //             error: "Not enough seats available!"
            //         });
            //     }

            // }


            const result = await bookingsCollection.insertOne(booking)
            res.send({ message: 'Booking successful', result })
        })

        app.patch('/bookings/:id', verifyFBToken, async (req, res) => {
            const id = req.params.id
            const updatedBooking = req.body
            const query = { _id: new ObjectId(id) }
            const result = await bookingsCollection.updateOne(query, { $set: updatedBooking })
            res.send(result)
        })


        // vendor
        app.get('/vendor/bookings-request', verifyFBToken, verifyVendor, async (req, res) => {
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
                { $unwind: { path: '$ticket', preserveNullAndEmptyArrays: true } },
                { $sort: { createdAt: -1 } }
            ]
            const result = await bookingsCollection.aggregate(pipeLine).toArray()
            res.send(result)
        })


        // payment related api
        app.post('/create-checkout-session', verifyFBToken, async (req, res) => {
            const paymentInfo = req.body
            const session = await stripe.checkout.sessions.create({
                line_items: [
                    {
                        // Provide the exact Price ID (for example, price_1234) of the product you want to sell
                        price_data: {
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
                    bookingTitle: paymentInfo.title,
                    ticketId: paymentInfo.ticketId,
                    quantity: paymentInfo.quantity?.toString(),
                },
                customer_email: paymentInfo.email,
                success_url: `${process.env.SITE_DOMAIN}/dashboard/payment-success?session_id={CHECKOUT_SESSION_ID}`,
                cancel_url: `${process.env.SITE_DOMAIN}/dashboard/payment-failed`,
            });

            res.send({ url: session.url });
        });


        app.patch('/payment-success', verifyFBToken, async (req, res) => {
            try {
                const session_id = req.query.session_id;
                const session = await stripe.checkout.sessions.retrieve(session_id);

                console.log(session);



                const trakingId = generateTicketId();

                if (session.payment_status === 'paid') {
                    const bookingId = session.metadata.bookingId;
                    const query = {
                        _id: new ObjectId(bookingId),
                        status: { $ne: 'paid' }
                    };

                    const updateBooking = {
                        $set: {
                            status: 'paid',
                            paymentId: session.id,
                            trakingId: trakingId
                        }
                    };

                    const bookingResult = await bookingsCollection.updateOne(query, updateBooking);


                    if (bookingResult.modifiedCount === 0) {

                        const existingBooking = await bookingsCollection.findOne({ _id: new ObjectId(bookingId) });

                        return res.send({
                            success: true,
                            message: "Already paid",
                            transactionId: session.payment_intent,
                            trakingId: existingBooking?.trakingId
                        });
                    }


                    const ticketId = session.metadata.ticketId;
                    const qtyToBook = parseInt(session.metadata.quantity);

                    const updatedTicket = await ticketsCollection.findOneAndUpdate(
                        {
                            _id: new ObjectId(ticketId),
                            quantity: { $gte: qtyToBook }
                        },
                        {
                            $inc: { quantity: -qtyToBook }
                        },
                        {
                            returnDocument: 'after'
                        }
                    );

                    const payment = {
                        amount: session.amount_total / 100,
                        customer_email: session.customer_email,
                        bookingId: session.metadata.bookingId,
                        ticketId: ticketId,
                        ticketTitle: session.metadata.bookingTitle,
                        transactionId: session.payment_intent,
                        paymentStatus: session.payment_status,
                        paidAt: new Date(),
                    }

                    const paymentResult = await paymentsCollection.insertOne(payment);

                    return res.send({
                        bookingResult,
                        updatedTicket,
                        trakingId: trakingId,
                        paymentResult,
                        transactionId: session.payment_intent,
                        success: true
                    });
                }

                return res.send({ success: false });

            } catch (error) {
                console.error(error);
                res.status(500).send({ message: "Internal Server Error" });
            }
        });


        // payment transaction api

        app.get('/payment-transaction', verifyFBToken, async (req, res) => {
            const email = req.query.email;

            if (req.decoded !== email) {
                return res.status(403).send({ message: 'Forbidden access' })
            }

            const query = { customer_email: email };
            const result = await paymentsCollection.find(query).sort({ paidAt: -1 }).toArray();
            res.send(result);
        });


        //=========================================

        app.get('/vendor/revenue-stats', async (req, res) => {
            const email = req.query.email;

            const query = { vendorEmail: email };
            const ticketQuery = { email: email };

            try {

                const bookingStats = await bookingsCollection.aggregate([
                    { $match: { status: 'paid', ...query } },
                    {
                        $group: {
                            _id: { $dateToString: { format: "%Y-%m-%d", date: { $toDate: "$bookingDate" } } },
                            revenue: { $sum: "$totalPrice" },
                            sold: { $sum: "$quantity" }
                        }
                    },
                    { $sort: { _id: 1 } }
                ]).toArray();


                const ticketStats = await ticketsCollection.aggregate([
                    {
                        $match: ticketQuery
                    },
                    {
                        $group: {
                            _id: { $dateToString: { format: "%Y-%m-%d", date: { $toDate: "$createdAt" } } },
                            added: { $sum: 1 }
                        }
                    },
                    { $sort: { _id: 1 } }
                ]).toArray();


                const allDates = [
                    ...new Set([
                        ...bookingStats.map(item => item._id),
                        ...ticketStats.map(item => item._id)
                    ])
                ].sort();

                const finalData = allDates.map(dateStr => {
                    const foundBooking = bookingStats.find(b => b._id === dateStr);
                    const foundTicket = ticketStats.find(t => t._id === dateStr);
                    const date = new Date(dateStr);
                    const dayMonth = date.toLocaleDateString('default', { day: 'numeric', month: 'short' });

                    return {
                        name: dayMonth,
                        revenue: foundBooking ? foundBooking.revenue : 0,
                        sold: foundBooking ? foundBooking.sold : 0,
                        added: foundTicket ? foundTicket.added : 0
                    };
                });

                res.send(finalData);

            } catch (error) {
                console.error(error);
                res.status(500).send({ message: 'Error fetching stats' });
            }
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
