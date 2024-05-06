require('dotenv').config()
const express = require("express");
const path = require("path");
const axios = require("axios");

const { open } = require("sqlite");
const sqlite3 = require("sqlite3");

const app = express();
const dbPath = path.join(__dirname, "database.db");

const port = 3004

let db = null;

const initializeDBAndServer = async () => {
  try {
    db = await open({
      filename: dbPath,
      driver: sqlite3.Database,
    });

    app.listen(process.env.PORT, () => {
      console.log("Server Running at http://localhost:3004/");
    });

    await fetchAndInsert();
  } catch (e) {
    console.log(`DB Error: ${e.message}`);
    process.exit(1);
  }
};
initializeDBAndServer();

const fetchAndInsert = async () => {

  try{
    const response = await axios.get(
      "https://s3.amazonaws.com/roxiler.com/product_transaction.json"
    );
    const data = response.data;
  
  
    for (let item of data) {
      const queryData = `SELECT id FROM transactions WHERE id = ${item.id}`;
      const existingData = await db.get(queryData);
      if (existingData === undefined) {
        const query = `
     INSERT INTO transactions (id, title, price, description, category, image, sold, dateOfSale) 
     VALUES (
         ${item.id},
         '${item.title.replace(/'/g, "''")}',
         ${item.price},
         '${item.description.replace(/'/g, "''")}',
         '${item.category.replace(/'/g, "''")}',
         '${item.image.replace(/'/g, "''")}',
         ${item.sold},
         '${item.dateOfSale.replace(/'/g, "''")}'
     );
  `; 
  
        await db.run(query);
      }
    }
    console.log("Transactions added");
  }
  catch(error){
    console.error("Error fetching or inserting transactions:", error);
  }
}
  


// Get API to list the all transactions

app.get("/transactions/:month", async (request, response) => {
  const { search_q = "", page = 1, per_page = 10 } = request.query;
  const offset = (page - 1) * per_page;
  const { month } = request.params;

  const getTransactionsQuery = `
    SELECT 
      * 
    FROM 
      transactions 
    WHERE 
      strftime("%m", dateOfSale) = ? 
      AND (
        title LIKE ? 
        OR 
        description LIKE ?
        OR 
        CAST(price AS TEXT) LIKE ?
      )
    ORDER BY 
      id 
    LIMIT 
      ? OFFSET ?
  `;

  try {
    const transactionsArray = await db.all(getTransactionsQuery, [
      month,
      `%${search_q}%`,
      `%${search_q}%`,
      `%${search_q}%`,
      per_page,
      offset
    ]);
    response.send(transactionsArray);
  } catch (error) {
    console.error("Error retrieving transactions:", error);
    response.status(500).json({ error: "Internal Server Error" });
  }
});


// Get API for statistics

app.get("/statistics/:month", async (request, response) => {
  try{
    const { month } = request.params;

  const totalSaleAmountQuery = `
    SELECT SUM(price) AS totalSaleAmount 
    FROM transactions 
    WHERE strftime("%m", dateOfSale) = ? 
      AND sold = 1
  `;
  const totalSaleAmountResult = await db.get(totalSaleAmountQuery, [month]);
  const totalSaleAmount = totalSaleAmountResult.totalSaleAmount || 0;

  const totalSoldItemsQuery = `
    SELECT COUNT(*) AS totalSoldItems 
    FROM transactions 
    WHERE strftime("%m", dateOfSale) = ? 
      AND sold = 1
  `;
  const totalSoldItemsResult = await db.get(totalSoldItemsQuery, [month]);
  const totalSoldItems = totalSoldItemsResult.totalSoldItems || 0;

  const totalNotSoldItemsQuery = `
    SELECT COUNT(*) AS totalNotSoldItems 
    FROM transactions 
    WHERE strftime("%m", dateOfSale) = ? 
      AND sold = 0
  `;
  const totalNotSoldItemsResult = await db.get(totalNotSoldItemsQuery, [month]);
  const totalNotSoldItems = totalNotSoldItemsResult.totalNotSoldItems || 0;

  response.send({
    totalSaleAmount,
    totalSoldItems,
    totalNotSoldItems
  });

  }

  catch(error){
    console.error("Error fetching statistics:", error);
    response.status(500).json({ error: "Internal Server Error" });
  }
  
});

// Get API for bar chart

app.get("/bar-chart/:month", async (request, response) => {

  try{
    const { month } = request.params;

    const priceRanges = [
      { range: "0 - 100", min: 0, max: 100 },
      { range: "101 - 200", min: 101, max: 200 },
      { range: "201 - 300", min: 201, max: 300 },
      { range: "301 - 400", min: 301, max: 400 },
      { range: "401 - 500", min: 401, max: 500 },
      { range: "501 - 600", min: 501, max: 600 },
      { range: "601 - 700", min: 601, max: 700 },
      { range: "701 - 800", min: 701, max: 800 },
      { range: "801 - 900", min: 801, max: 900 },
      { range: "901 - above", min: 901, max: Infinity } 
    ];
  
    const priceRangeCounts = [];
  
    for (const range of priceRanges) {
      const { min, max } = range;
  
      const countQuery = `
        SELECT COUNT(*) AS count 
        FROM transactions 
        WHERE strftime("%m", dateOfSale) = ? 
          AND price >= ? 
          AND price <= ?
      `;
  
      const result = await db.get(countQuery, [month, min, max]);
  
      priceRangeCounts.push({
        range: range.range,
        count: result.count
      });
    }
  
    response.json(priceRangeCounts);
  }
  catch(error){
    console.error("Error fetching data for bar chart:", error);
    response.status(500).json({ error: "Internal Server Error" });
  }
 
});

// Get API for pie chart Find unique categories and number of items from that category for the selected month regardless of the year.

app.get("/pie-chart/:month", async (request, response) => {
  const { month } = request.params;

  const categoriesQuery = `
    SELECT category, COUNT(*) AS itemCount
    FROM transactions
    WHERE strftime("%m", dateOfSale) = ?
    GROUP BY category
  `;

  try {
    const categoriesResult = await db.all(categoriesQuery, [month]);

    const pieChartData = categoriesResult.map(({ category, itemCount }) => ({
      category,
      itemCount
    }));

    response.json(pieChartData);
  } catch (error) {
    console.error("Error retrieving pie chart data:", error);
    response.status(500).json({ error: "Internal Server Error" });
  }
});


// Get API which fetches the data from all the 3 APIs mentioned above, combines the response and sends a final response of the combined JSON

const baseUrls = [
  "http://localhost:3004/pie-chart/",
  "http://localhost:3004/bar-chart/",
  "http://localhost:3004/statistics/"
];

app.get("/combined-data/:month", async (request, response) => {
  try {
    const { month } = request.params;
    const combinedData = [];
    for (const baseUrl of baseUrls) {

      const endpoint = `${baseUrl}${month}`;
      
      const fetchedData = await axios.get(endpoint);
      
      combinedData.push(fetchedData.data);
    }

    response.json(combinedData);
  } catch (error) {
    console.error("Error fetching data:", error);
    response.status(500).json({ error: "Internal Server Error" });
  }
});

