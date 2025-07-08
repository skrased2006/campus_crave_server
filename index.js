require('dotenv').config();
const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');

const app = express();
const port = process.env.PORT || 5000;

// middleware
app.use(cors({
  origin: ['http://localhost:5173'],
  credentials: true
}));
app.use(express.json());
app.use(cookieParser());

// MongoDB Connection


const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.jogbo5m.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});

async function run() {
  try {
    await client.connect();
    const db = client.db("hostelDB");

    const usersCollection = db.collection("users");
    const mealsCollection = db.collection("meals");
    const reviewsCollection = db.collection("reviews");

    app.post('/meals', async (req, res) => {
      const meal = req.body;
      meal.rating = 0;
      meal.likes = 0;
      meal.reviews_count = 0;

      const result = await mealsCollection.insertOne(meal);
      res.send(result);
    });
    app.get('/meals/:id', async (req, res) => {
      try {
        const id = req.params.id;
        const meal = await mealsCollection.findOne({ _id: new ObjectId(id) });
        if (!meal) {
          return res.status(404).send({ message: "Meal not found" });
        }
        res.send(meal);
      } catch (error) {
        console.error(error);
        res.status(500).send("Server error");
      }
    });



    app.get('/allmeals', async (req, res) => {
      try {
        const sortBy = req.query.sortBy || 'likes'; // default: likes
        const sortOrder = req.query.order === 'asc' ? 1 : -1; // default: descending

        const sortOption = {};
        sortOption[sortBy] = sortOrder;

        const meals = await mealsCollection.find().sort(sortOption).toArray();
        res.send(meals);
      } catch (error) {
        console.error("Error fetching meals:", error);
        res.status(500).send("Failed to fetch meals");
      }
    });
    app.get('/meals', async (req, res) => {
      const page = parseInt(req.query.page) || 0;
      const size = parseInt(req.query.size) || 6;
      const category = req.query.category;

      const query = category ? { category } : {};
      const meals = await mealsCollection
        .find(query)
        .skip(page * size)
        .limit(size)
        .toArray();

      res.send(meals);
    });


    app.post('/users', async (req, res) => {
      const user = req.body;
      const newUser = await usersCollection.insertOne(user);
      res.status(201).send({ message: 'User created', userId: newUser._id });
    });

    // server/routes/userRoutes.js or inside your Express route file
    app.get("/users", async (req, res) => {
      const search = req.query.search || "";
      const query = {
        $or: [
          { name: { $regex: search, $options: "i" } },
          { email: { $regex: search, $options: "i" } },
        ],
      };
      const users = await usersCollection.find(query).toArray();
      res.send(users);
    });

    app.patch("/users/admin/:id", async (req, res) => {
      const id = req.params.id;
      const result = await usersCollection.updateOne(
        { _id: new ObjectId(id) },
        { $set: { role: "admin" } }
      );
      res.send(result);
    });
    // Assuming usersCollection is your MongoDB collection
    app.patch('/users/:id/role', async (req, res) => {
      const userId = req.params.id;
      const { role } = req.body;

      try {
        const result = await usersCollection.updateOne(
          { _id: new ObjectId(userId) },
          { $set: { role: role } }
        );

        res.send(result);
      } catch (err) {
        console.error('Failed to update role:', err);
        res.status(500).send({ message: 'Failed to update role' });
      }
    });

    // Example route: server-side code (Node.js + Express)

    app.get('/users/search', async (req, res) => {
      const query = req.query.query;

      if (!query) {
        return res.status(400).send({ message: 'Search query required' });
      }

      try {
        const result = await usersCollection.find({
          $or: [
            { email: { $regex: query, $options: 'i' } },
            { name: { $regex: query, $options: 'i' } },
          ],
        }).toArray();

        res.send(result);
      } catch (err) {
        console.error(err);
        res.status(500).send({ message: 'Server Error' });
      }
    });








    await client.db("admin").command({ ping: 1 });
    console.log("Pinged your deployment. You successfully connected to MongoDB!");

  } catch (err) {
    console.error("MongoDB connection error:", err);
  }
}

run().catch(console.dir);


app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
