require('dotenv').config();


const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');

const admin = require("firebase-admin");
const app = express();
const port = process.env.PORT || 5000;


app.use(cors({
  origin: ['http://localhost:5173'],
  credentials: true
}));
app.use(express.json());
app.use(cookieParser());



var serviceAccount = require("./admin.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});



const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);


const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.jogbo5m.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;


const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});


// custom middleware 




const db = client.db("hostelDB");


const usersCollection = db.collection("users");
const mealsCollection = db.collection("meals");
const reviewsCollection = db.collection("reviews");
const paymentsCollection = db.collection("payment");
const likesCollection = db.collection("likes");
const mealRequestsCollection = db.collection('mealRequests');
const upcomingMealsCollection = db.collection('upcomingMeals');


const verifyFBToken = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return res.status(401).send({ message: 'unauthorized access' })
  }
  const token = authHeader.split(' ')[1];
  if (!token) {
    return res.status(401).send({ message: 'unauthorized access' })
  }
  try {
    const decoded = await admin.auth().verifyIdToken(token);
    req.decoded = decoded;
    next();
  }
  catch (error) {
    return res.status(403).send({ message: 'forbidden access' })
  }
}


const verifyAdmin = async (req, res, next) => {
  const email = req.decoded.email; // from verifyFBToken
  const query = { email };

  const user = await usersCollection.findOne(query);
  if (!user || user.role !== 'admin') {
    return res.status(403).send({ message: 'forbidden access' });
  }

  next(); // go to the actual route
};


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
app.get('/allmeals', verifyFBToken, async (req, res) => {
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
app.get("/users/search", verifyFBToken, async (req, res) => {
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
app.get("/payments/:email", verifyFBToken, async (req, res) => {
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
app.get("/my-reviews/:email", verifyFBToken, async (req, res) => {
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

app.get("/reviews", verifyFBToken, verifyAdmin, async (req, res) => {
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
  const { mealId, userEmail, userName, mealTitle } = req.body;

  const user = await usersCollection.findOne({ email: userEmail });


  if (!user || user.badge?.toLowerCase() === 'bronze') {
    return res.status(403).send({ message: 'Only premium users can request meals.' });
  }

  const existing = await mealRequestsCollection.findOne({ mealId, userEmail });
  if (existing) {
    return res.status(400).send({ message: 'You have already requested this meal.' });
  }

  const result = await mealRequestsCollection.insertOne({
    mealId: new ObjectId(mealId),
    userEmail,
    userName,
    status: 'pending',
    mealTitle,
    requestedAt: new Date(),
  });

  res.send({ insertedId: result.insertedId });
});



// Get requested meals for a user
app.get('/meal-requests/:email', verifyFBToken, async (req, res) => {
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
app.get('/users/:email', verifyFBToken, async (req, res) => {
  const email = req.params.email;
  const user = await usersCollection.findOne({ email });

  if (!user) {
    return res.status(404).send({ message: 'User not found' });
  }

  res.send(user);
});




// upcomming meals
app.post('/upcoming-meals', async (req, res) => {
  const {
    title,
    category,
    price,
    ingredients,
    image,
    distributor,
    description,
    rating,
  } = req.body;
  console.log('Incoming meal data:', req.body);

  if (
    !title ||
    !category ||
    !price ||
    !ingredients ||
    !image ||
    !distributor ||
    !description ||
    rating === undefined || rating === null
  ) {
    return res.status(400).send({ message: 'Missing required fields' });
  }


  const meal = {
    title,
    category,
    price,
    ingredients,
    image,
    distributor,
    description,
    rating,
    likes: 0,
    postTime: new Date()
  };

  const result = await upcomingMealsCollection.insertOne(meal);
  res.send(result);
});

app.post("/publish-meal/:id", async (req, res) => {
  const id = req.params.id;

  try {
    // ১. প্রথমে upcoming-meals collection থেকে ওই meal খুঁজে বের করো
    const meal = await upcomingMealsCollection.findOne({ _id: new ObjectId(id) });
    if (!meal) {
      return res.status(404).send({ message: "Meal not found" });
    }

    // ২. meals collection এ add করো
    const { insertedId } = await mealsCollection.insertOne(meal);

    if (!insertedId) {
      return res.status(500).send({ message: "Failed to publish meal" });
    }

    // ৩. চাইলে ওই upcoming meal টা ডিলিট করতে পারো অথবা ডিলিট না করেও রাখতে পারো
    await upcomingMealsCollection.deleteOne({ _id: new ObjectId(id) });

    res.send({ message: "Meal published successfully" });
  } catch (error) {
    console.error("Publish meal error:", error);
    res.status(500).send({ message: "Internal Server Error" });
  }
});

app.get("/upcoming-meals", verifyFBToken, verifyAdmin, async (req, res) => {
  try {
    // সকল upcoming meals ডাটাবেজ থেকে নিয়ে আসবে
    const meals = await upcomingMealsCollection
      .find({})
      .sort({ likes: -1 })   // likes অনুসারে sorting (বেশি liked গুলো উপরে)
      .toArray();

    res.send(meals);
  } catch (error) {
    console.error("Error fetching upcoming meals:", error);
    res.status(500).send({ message: "Internal Server Error" });
  }
});


// ✅ Like an upcoming meal by ID
app.patch('/upcoming-meals/like/:id', async (req, res) => {
  const mealId = req.params.id;           // URL থেকে meal এর id নিয়ে আসছে
  const userEmail = req.body.userEmail;  // রিকোয়েস্ট বডি থেকে ইউজারের ইমেইল নিচ্ছে

  // ডাটাবেজ থেকে meal খুঁজছে
  const meal = await upcomingMealsCollection.findOne({ _id: new ObjectId(mealId) });

  // meal না পাওয়া গেলে 404 রেসপন্স দিবে
  if (!meal) {
    return res.status(404).send({ message: 'Meal not found' });
  }

  // দেখে নিচ্ছে user ইতিমধ্যে like দিয়েছে কিনা
  const alreadyLiked = meal.likedUsers?.includes(userEmail);
  if (alreadyLiked) {
    return res.send({ message: 'Already liked' }); // যদি like দিয়ে থাকে, তাহলে মেসেজ রিটার্ন
  }

  // যদি like না দিয়ে থাকে, তাহলে likes 1 বাড়াবে এবং likedUsers এ userEmail যোগ করবে
  const updateDoc = {
    $inc: { likes: 1 },
    $push: { likedUsers: userEmail },
  };

  // ডাটাবেজে আপডেট করবে
  const result = await upcomingMealsCollection.updateOne(
    { _id: new ObjectId(mealId) },
    updateDoc
  );

  // আপডেটের রেজাল্ট রিটার্ন করবে
  res.send(result);
});




// serve meal

// GET /meal-requests?search=keyword
app.get('/meal-requests', verifyFBToken, async (req, res) => {
  try {
    const search = req.query.search || "";

    const filter = {
      $or: [
        { userName: { $regex: search, $options: "i" } },
        { userEmail: { $regex: search, $options: "i" } }
      ]
    };

    const result = await mealRequestsCollection.find(filter).sort({ requestTime: -1 }).toArray();
    res.send(result);
  } catch (error) {
    res.status(500).send({ message: "Failed to load meal requests", error });
  }
});

// PATCH /meal-requests/:id/deliver
app.patch('/meal-requests/:id/deliver', async (req, res) => {
  const id = req.params.id;

  try {
    const result = await mealRequestsCollection.updateOne(
      { _id: new ObjectId(id) },
      { $set: { status: 'delivered' } }
    );

    res.send(result);
  } catch (error) {
    res.status(500).send({ message: "Failed to update status", error });
  }
});

















// Start Express server
app.listen(port, () => {
  console.log(`🚀 Server running on port ${port}`);
});
