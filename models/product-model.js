const mongoose = require("mongoose");
const { v4: uuidv4 } = require("uuid");

const products = new mongoose.Schema({
    style_code: { 
        type: String, 
        required: true 
    },
    option_code: { 
        type: String, 
        required: true 
    },
    EAN_code: {
        type: String,
        unique: true,
        default: () => uuidv4().replace(/-/g, "").substring(0, 12)
    }, // Generates a 12-character unique ID
    MRP: { 
        type: Number, 
        required: true 
    },
    Brick: { 
        type: String, 
        enum: ["Shirt", "T-shirt", "Jeans", "Trouser"], 
        required: true 
    },
    Sleeve: { 
        type: String, 
        enum: ["Full Sleeve", "Half Sleeve", "Sleeveless"], 
        required: true 
    },
});

module.exports = mongoose.model("Product", products);
