const express = require('express')
const mongoose = require('mongoose')
const multer = require('multer')
const path = require('path')
const bodyParser = require('body-parser')
const csv = require('csvtojson')
require('dotenv').config();

const app = express()
mongoose
  .connect(process.env.MONGO_URI)
  .then(() => console.log("DB Connected."))
  .catch((err) => console.error("MongoDB Connection Failed:", err));


app.use(bodyParser.urlencoded({extended:true}))

app.use(express.static(path.resolve(__dirname,'public')))

var storage = multer.diskStorage({
    destination : (req,file,cb) => {
        cb(null, './public/uploads')
    },
    filename : (req,file,cb) => {
        cb(null, file.originalname)
    }
})

var upload  = multer({ storage : storage})

const productModel = require('./models/product-model')

app.post('/dataupload', upload.single('file'),(req,res) => {
    var data = []
    try {
        csv().fromFile(req.file.path).then( async (res) => {
            // console.log(res)
            for(var i=0;i<res.length;i++){
                data.push({
                    style_code: res[i].style_code,
                    option_code: res[i].option_code,
                    EAN_code: res[i].EAN_code,
                    MRP: res[i].MRP,
                    Brick: res[i].Brick,
                    Sleeve: res[i].Sleeve,
                  });
            }
            await productModel.insertMany(data)
        })
        res.status(200).json({ success: true, message: "Successful data exported." });
    } catch (error) {
        console.log(error);
        res.status(400).json({ success: false, message: error.message });
    }
})

// API to fetch all data
app.get('/get-all-products', async (req, res) => {
    try {
        const products = await productModel.find(); 
        res.status(200).json({ success: true, data: products });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});


// Filter API According to key-value eg: /products?MRP=799
app.get('/products', async (req, res) => {
    try {
        let filters = {};

        if (req.query.style_code) filters.style_code = req.query.style_code;
        if (req.query.option_code) filters.option_code = req.query.option_code;
        if (req.query.MRP) filters.MRP = Number(req.query.MRP);
        
        // Case-insensitive filtering for Brick and Sleeve with validation
        const validBricks = ["Shirt", "T-shirt", "Jeans", "Trouser"];
        if (req.query.Brick) {
            const formattedBrick = req.query.Brick.toLowerCase();
            const matchedBrick = validBricks.find(b => b.toLowerCase() === formattedBrick);
            if (matchedBrick) filters.Brick = matchedBrick;
        }
        
        const validSleeves = ["Full Sleeve", "Half Sleeve", "Sleeveless"];
        if (req.query.Sleeve) {
            const formattedSleeve = req.query.Sleeve.trim().toLowerCase().replace(/\s+/g, ' '); // Normalize spaces
            const matchedSleeve = validSleeves.find(s => s.toLowerCase() === formattedSleeve);
            if (matchedSleeve) filters.Sleeve = matchedSleeve;
        }

        const products = await productModel.find(filters);
        res.status(200).json({ success: true, data: products });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

app.get('/grouped-products', async (req, res) => {
    try {
        let filters = {};

        if (req.query.style_code) filters.style_code = req.query.style_code;
        if (req.query.option_code) filters.option_code = req.query.option_code;
        if (req.query.MRP) filters.MRP = Number(req.query.MRP);

        // Case-insensitive filtering for Brick
        const validBricks = ["Shirt", "T-shirt", "Jeans", "Trouser"];
        if (req.query.Brick) {
            const formattedBrick = req.query.Brick.trim().toLowerCase();
            const matchedBrick = validBricks.find(b => b.toLowerCase() === formattedBrick);
            if (matchedBrick) filters.Brick = matchedBrick;
        }

        // Case-insensitive filtering for Sleeve with proper space handling
        const validSleeves = ["Full Sleeve", "Half Sleeve", "Sleeveless"];
        if (req.query.Sleeve) {
            const formattedSleeve = req.query.Sleeve.trim().toLowerCase().replace(/\s+/g, ' ');
            const matchedSleeve = validSleeves.find(s => s.toLowerCase() === formattedSleeve);
            if (matchedSleeve) filters.Sleeve = matchedSleeve;
        }

        // MongoDB aggregation pipeline to filter and group data
        const groupedData = await productModel.aggregate([
            // Match the filters
            { $match: filters },
            
            // Group by option_code
            { $group: {
                _id: "$option_code", // Group by option_code
                products: { $push: "$$ROOT" } // Push all the product details into an array
            }},
            
            // Optional: sort or project specific fields if needed
            { $project: {
                option_code: "$_id",
                products: 1,
                _id: 0
            }}
        ]);

        // Return grouped data
        res.status(200).json({ success: true, data: groupedData });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

app.listen(5000, function(){
    console.log("App is running")
})