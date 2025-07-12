// Load environment variables
require('dotenv').config();

// Core dependencies
const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');

// Create Express app
const app = express();
const port = process.env.PORT || 5000;

// Middleware setup
app.use(cors({
  origin: ['http://localhost:5173'], // Frontend URL
  credentials: true
}));
app.use(express.json());
app.use(cookieParser());

// Stripe configuration
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

// MongoDB URI
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.jogbo5m.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

// Create MongoDB client
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});

// Main server function
async function run() {
  try {
    await client.connect();
    const db = client.db("hostelDB");

    // Collections
    const usersCollection = db.collection("users");
    const mealsCollection = db.collection("meals");
    const reviewsCollection = db.collection("reviews");
    const paymentsCollection = db.collection("payment");
    const likesCollection = db.collection("likes");
    const mealRequestsCollection = db.collection('mealRequests');
    const upcomingMealsCollection = db.collection('upcomingMeals');

    // ========== Meal Routes ==========

    // Add a new meal
    app.post('/meals', async (req, res) => {
      const meal = req.body;
      meal.rating = 0;
      meal.likes = 0;
      meal.reviews_count = 0;

      const result = await mealsCollection.insertOne(meal);
      res.send(result);
    });

    // Get all meals with optional sort                           
    app.get('/allmeals', async (req, res) => {
      const sortBy = req.query.sortBy || 'likes';
      const sortOrder = req.query.order === 'asc' ? 1 : -1;
      const sortOption = {};
      sortOption[sortBy] = sortOrder;

      const meals = await mealsCollection.find().sort(sortOption).toArray();
      res.send(meals);
    });

    // Paginated meals by category
    app.get('/meals', async (req, res) => {
      const page = parseInt(req.query.page) || 0;
      const size = parseInt(req.query.size) || 6;
      const category = req.query.category;
      const query = category ? { category } : {};

      const meals = await mealsCollection.find(query).skip(page * size).limit(size).toArray();
      res.send(meals);
    });

    // Route: GET /meals
    // Query params: search, category, minPrice, maxPrice, page, limit
    app.get('/mealpage', async (req, res) => {
      const { search, category, minPrice, maxPrice, page = 1, limit = 10 } = req.query;

      const query = {};

      // 🔍 Search by meal title
      if (search) {
        query.title = { $regex: search, $options: 'i' };
      }

      // 🍽️ Filter by category
      if (category && category !== 'All') {
        query.category = category;
      }

      // 💸 Filter by price range
      if (minPrice || maxPrice) {
        query.price = {};
        if (minPrice) query.price.$gte = parseFloat(minPrice);
        if (maxPrice) query.price.$lte = parseFloat(maxPrice);
      }

      const skip = (parseInt(page) - 1) * parseInt(limit);
      const meals = await mealsCollection.find(query)
        .skip(skip)
        .limit(parseInt(limit))
        .toArray();

      const total = await mealsCollection.countDocuments(query);

      res.send({ meals, total });
    });


    // Get meal by ID
    app.get('/meals/:id', async (req, res) => {
      try {
        const id = req.params.id;
        const meal = await mealsCollection.findOne({ _id: new ObjectId(id) });
        if (!meal) return res.status(404).send({ message: "Meal not found" });
        res.send(meal);
      } catch (error) {
        console.error(error);
        res.status(500).send("Server error");
      }
    });

    // Admin meals by user email
    app.get('/admin_meals', async (req, res) => {
      const email = req.query.email;
      const meals = await mealsCollection.find({ email }).toArray();
      res.send(meals);
    });

    // ========== User Routes ==========

    // Create a new user
    app.post('/users', async (req, res) => {
      const user = req.body;
      const newUser = await usersCollection.insertOne(user);
      res.status(201).send({ message: 'User created', userId: newUser._id });
    });

    // Search users (name or email)
    app.get("/users/search", async (req, res) => {
      const query = req.query.query;
      if (!query) return res.status(400).send({ message: 'Search query required' });

      const result = await usersCollection.find({
        $or: [
          { email: { $regex: query, $options: 'i' } },
          { name: { $regex: query, $options: 'i' } },
        ],
      }).toArray();

      res.send(result);
    });

    // Update user role
    app.patch('/users/:id/role', async (req, res) => {
      const userId = req.params.id;
      const { role } = req.body;

      const result = await usersCollection.updateOne(
        { _id: new ObjectId(userId) },
        { $set: { role: role } }
      );
      res.send(result);
    });

    // Get user role by email
    app.get("/users/:email/role", async (req, res) => {
      const email = req.params.email;
      const user = await usersCollection.findOne({ email });
      res.send({ role: user?.role || 'user' });
    });

    // Express server
    app.patch("/users/badge/:email", async (req, res) => {
      const email = req.params.email;
      const { badge } = req.body;

      const result = await usersCollection.updateOne(
        { email },
        { $set: { badge } }
      );

      res.send(result);
    });


    // ========== Payment & Subscription ==========

    // Stripe Payment Intent
    app.post("/create-payment-intent", async (req, res) => {
      const { price } = req.body;
      const amount = parseInt(price * 100); // convert to cents
      const paymentIntent = await stripe.paymentIntents.create({
        amount,
        currency: "usd",
        payment_method_types: ["card"],
      });
      res.send({ clientSecret: paymentIntent.client_secret });
    });

    // Save payment info
    app.post("/payments", async (req, res) => {
      const payment = req.body;
      const result = await paymentsCollection.insertOne(payment);
      res.send(result);
    });

    // Update user badge
    app.patch("/users/badge/:email", async (req, res) => {
      const email = req.params.email;
      const { badge } = req.body;
      const result = await usersCollection.updateOne(
        { email },
        { $set: { badge } }
      );
      res.send(result);
    });

    // Get payment history
    app.get("/payments/:email", async (req, res) => {
      const email = req.params.email;
      const payments = await paymentsCollection.find({ email }).sort({ date: -1 }).toArray();
      res.send(payments);
    });

    // ========== Like System ==========

    // Like a meal (user-based, one-time)
    app.patch("/meals/like/:id", async (req, res) => {
      try {
        const mealId = req.params.id;
        const email = req.body?.email;

        if (!email) {
          return res.status(400).send({ message: "User email is required in body" });
        }

        const existingLike = await likesCollection.findOne({
          mealId: new ObjectId(mealId),
          userEmail: email,
        });

        if (existingLike) {
          return res.send({ liked: true, modifiedCount: 0 });
        }

        await likesCollection.insertOne({
          mealId: new ObjectId(mealId),
          userEmail: email,
          time: new Date(),
        });

        const result = await mealsCollection.updateOne(
          { _id: new ObjectId(mealId) },
          { $inc: { likes: 1 } }
        );

        res.send({ liked: true, modifiedCount: result.modifiedCount });

      } catch (error) {
        console.error("Like route error:", error);
        res.status(500).send({ message: "Internal Server Error" });
      }
    });


    // Check if user liked a meal
    app.get("/likes/check/:mealId", async (req, res) => {
      const mealId = req.params.mealId;
      const email = req.query.email;
      if (!email) return res.send({ liked: false });

      const liked = await likesCollection.findOne({
        mealId: new ObjectId(mealId),
        userEmail: email,
      });

      res.send({ liked: !!liked });
    });

    // riviwe collection

    app.post("/reviews", async (req, res) => {
      const review = req.body;

      const result = await reviewsCollection.insertOne(review);

      // Optional: meal এর review_count বাড়াতে চাইলে
      await mealsCollection.updateOne(
        { _id: new ObjectId(review.mealId) },
        { $inc: { reviews_count: 1 } }
      );

      res.send({ insertedId: result.insertedId, review });
    });

    // ✅ Correct Backend Route
    app.get("/my-reviews/:email", async (req, res) => {
      const email = req.params.email;

      try {
        const reviews = await reviewsCollection
          .find({ email: email }) // ⬅️ match with "email" field
          .sort({ time: -1 })
          .toArray();

        res.send(reviews);
      } catch (error) {
        console.error("Error fetching user reviews:", error);
        res.status(500).send({ message: "Server error" });
      }
    });

    app.get("/reviews", async (req, res) => {
      try {
        const reviews = await reviewsCollection
          .find()
          .sort({ time: -1 }) // latest first
          .toArray();
        res.send(reviews);
      } catch (err) {
        res.status(500).send({ message: "Failed to fetch reviews" });
      }
    });


    app.get("/reviews/:mealId", async (req, res) => {
      const mealId = req.params.mealId;

      try {
        const reviews = await reviewsCollection
          .find({ mealId })
          .sort({ time: -1 }) // নতুন আগে
          .toArray();

        res.send(reviews);
      } catch (err) {
        res.status(500).send({ message: "Failed to fetch reviews" });
      }
    });

    app.delete('/reviews/:id', async (req, res) => {
      const id = req.params.id;

      const result = await reviewsCollection.deleteOne({ _id: new ObjectId(id) });
      res.send(result);
    });
    app.patch('/reviews/:id', async (req, res) => {
      const id = req.params.id;
      const { review } = req.body;

      const result = await reviewsCollection.updateOne(
        { _id: new ObjectId(id) },
        { $set: { review } }
      );

      res.send(result);
    });




    // meal request


    app.post('/meal-requests', async (req, res) => {
      const { mealId, userEmail, userName } = req.body;

      const user = await usersCollection.findOne({ email: userEmail });
      console.log("USER:", user); // 🐞 Debug

      if (!user || user.badge?.toLowerCase() === 'bronze') {
        return res.status(403).send({ message: 'Only premium users can request meals.' });
      }

      const existing = await mealRequestsCollection.findOne({ mealId, userEmail });
      if (existing) {
        return res.status(400).send({ message: 'You have already requested this meal.' });
      }

      const result = await db.collection('mealRequests').insertOne({
        mealId: new ObjectId(mealId),
        userEmail,
        userName,
        status: 'pending',
        requestedAt: new Date(),
      });

      res.send({ insertedId: result.insertedId });
    });



    // Get requested meals for a user
    app.get('/meal-requests/:email', async (req, res) => {
      const email = req.params.email;

      // Join mealRequests with meals collection to get meal info
      const requests = await mealRequestsCollection.aggregate([
        { $match: { userEmail: email } },
        {
          $lookup: {
            from: "meals",
            localField: "mealId",
            foreignField: "_id",
            as: "mealDetails"
          }
        },
        { $unwind: "$mealDetails" },
        {
          $project: {
            _id: 1,
            status: 1,
            requestedAt: 1,
            mealTitle: "$mealDetails.title",
            likes: "$mealDetails.likes",
            reviews_count: "$mealDetails.reviews_count"
          }
        }
      ]).toArray();

      res.send(requests);
    });

    // Cancel a meal request by request ID
    app.delete('/meal-requests/:id', async (req, res) => {
      const id = req.params.id;
      const result = await mealRequestsCollection.deleteOne({ _id: new ObjectId(id) });
      res.send(result);
    });

    // ✅ Get full user info by email
    app.get('/users/:email', async (req, res) => {
      const email = req.params.email;
      const user = await usersCollection.findOne({ email });

      if (!user) {
        return res.status(404).send({ message: 'User not found' });
      }

      res.send(user);
    });






    // ========== MongoDB Connection Test ==========
    await client.db("admin").command({ ping: 1 });
    console.log("✅ Connected to MongoDB successfully!");

  } catch (err) {
    console.error("❌ MongoDB connection error:", err);
  }
}

// Run the server
run().catch(console.dir);

// Start Express server
app.listen(port, () => {
  console.log(`🚀 Server running on port ${port}`);
});
