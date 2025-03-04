const express = require('express');
const mongoose = require('mongoose');
const multer = require('multer');
const path = require('path');
const bodyParser = require('body-parser');
const csv = require('csvtojson');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
require('dotenv').config();

const app = express();

// Connect to MongoDB
mongoose
  .connect(process.env.MONGO_URI)
  .then(() => {
    console.log("DB Connected.");
  })
  .catch((err) => console.error("MongoDB Connection Failed:", err));

app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(path.resolve(__dirname, 'public')));

// Configure Multer for File Uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, './public/uploads');
  },
  filename: (req, file, cb) => {
    cb(null, file.originalname);
  },
});

const upload = multer({ storage: storage });


// Function to Get or Register the Model
const getDynamicModel = () => {
  return mongoose.models.DynamicData || mongoose.model('DynamicData', new mongoose.Schema({}, { strict: false }));
};

// Route to Upload CSV and export data
app.post('/dataupload', upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ success: false, message: 'No file uploaded' });
  }

  const filePath = req.file.path;

  try {
    const jsonArray = await csv().fromFile(filePath);
    if (jsonArray.length === 0) {
      return res.status(400).json({ success: false, message: 'Empty CSV file' });
    }

    const DynamicModel = getDynamicModel();

    // EAN_code
    for (let i = 0; i < jsonArray.length; i++) {
      if (!jsonArray[i].EAN_code) {
        jsonArray[i].EAN_code = uuidv4().replace(/-/g, "").substring(0, 12);
      }

      // Check if EAN_code already exists
      let existingRecord = await DynamicModel.findOne({ EAN_code: jsonArray[i].EAN_code });
      while (existingRecord) {
        jsonArray[i].EAN_code = uuidv4().replace(/-/g, "").substring(0, 12);
        existingRecord = await DynamicModel.findOne({ EAN_code: jsonArray[i].EAN_code });
      }
    }

    // Insert data into the collection
    await DynamicModel.insertMany(jsonArray);
    res.status(200).json({ success: true, message: 'Data successfully imported' });
  } catch (error) {
    console.error("Error in uploading.", error);
    res.status(500).json({ success: false, message: 'Internal Server Error' });
  } finally {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  }
});

// Route to Fetch All Data
app.get('/fetchdata', async (req, res) => {
  try {
    const DynamicModel = getDynamicModel();
    const data = await DynamicModel.find();

    if (data.length === 0) {
      return res.status(404).json({ success: false, message: 'No records found' });
    }

    res.status(200).json({ success: true, data });
  } catch (error) {
    console.error("rror fetching data:", error);
    res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
});

// API to get schema
app.get('/getschema', async (req, res) => {
  try {
    const DynamicModel = getDynamicModel();
    const data = await DynamicModel.find();

    if (data.length === 0) {
      return res.status(404).json({ success: false, message: 'No records found' });
    }

    let schemaKeys = new Set();
    let valueCounts = {};

    // Loop through each document
    data.forEach((doc) => {
      const docObj = doc.toObject();

      Object.keys(docObj).forEach((key) => {
        if (key === "_id" || key === "__v") return;

        schemaKeys.add(key);

        if (!valueCounts[key]) {
          valueCounts[key] = {}; // Initialize if key is not present
        }

        const value = docObj[key];
        valueCounts[key][value] = (valueCounts[key][value] || 0) + 1;
      });
    });

    res.status(200).json({
      success: true,
      schema: Array.from(schemaKeys),
      uniqueValues: valueCounts,
    });

  } catch (error) {
    console.error("Error fetching schema:", error);
    res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
});

// API to filter
app.get('/filterdata', async (req, res) => {
  try {
    const schemaResponse = await fetch(`http://localhost:${process.env.PORT || 5000}/getschema`);
    const schemaData = await schemaResponse.json();

    if (!schemaData.success) {
      return res.status(400).json({ success: false, message: "Schema fetch failed" });
    }

    const schemaKeys = schemaData.schema; // List of valid filter fields
    const filters = {};

    // Loop through query params and apply only valid ones
    Object.keys(req.query).forEach((key) => {
      if (schemaKeys.includes(key)) {
        filters[key] = req.query[key];
      }
    });

    const DynamicModel = getDynamicModel();
    const filteredData = await DynamicModel.find(filters);

    if (filteredData.length === 0) {
      return res.status(404).json({ success: false, message: 'No matching records found' });
    }

    res.status(200).json({ success: true, data: filteredData });
  } catch (error) {
    console.error("Error filtering data:", error);
    res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
});

// Grouping API
app.get('/grouped-products', async (req, res) => {
  try {
    const { groupBy, ...filters } = req.query;

    if (!groupBy) {
      return res.status(400).json({ success: false, message: 'Missing "groupBy" parameter' });
    }

    const DynamicModel = getDynamicModel();


    const firstRecord = await DynamicModel.findOne().lean();
    if (!firstRecord) {
      return res.status(404).json({ success: false, message: 'No records found' });
    }
    const schemaKeys = Object.keys(firstRecord);

    let query = {};

    for (const key in filters) {
      if (schemaKeys.includes(key)) {
        if (!isNaN(filters[key])) {
          query[key] = Number(filters[key]);
        } else {
          query[key] = { $regex: new RegExp(`^${filters[key]}$`, 'i') }; // Case-insensitive match
        }
      }
    }

    // Fetch filtered data
    const products = await DynamicModel.find(query).select('-_id -__v'); // Exclude _id & __v

    if (products.length === 0) {
      return res.status(404).json({ success: false, message: 'No records found' });
    }

    // Grouping logic
    const groupedData = products.reduce((acc, product) => {
      const key = product[groupBy];

      if (!key) return acc; // Skip if group key is missing

      if (!acc[key]) acc[key] = [];
      acc[key].push(product);

      return acc;
    }, {});

    res.status(200).json({ success: true, groupedData });

  } catch (error) {
    console.error("Error fetching grouped data:", error);
    res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
});


const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
