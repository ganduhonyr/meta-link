const express = require("express");
const mysql = require('mysql2');
const cors = require('cors');
const nodemailer = require("nodemailer");
const multer = require('multer');
const path = require('path');
const app = express();
app.use(cors());
app.use(express.json());

app.use(cors({
  origin: "http://localhost:8081",
  credentials: true
}));
app.use(express.json());

const db = mysql.createConnection({
  host: "",
  user: "",
  password: "",
  database: ""
});


db.connect((err) => {
  if (err) {
    console.error('Error connecting to the database:', err);
    return;
  }
  console.log('Connected to the MySQL database.');
});


const sql = 'UPDATE member_plan SET member_plan_proof = ? WHERE id = ?';
db.query(sql, [fileName, planId], (err, result) => {
  if (err) {
    console.error('Error updating plan proof:', err);
    return res.status(500).json({ error: 'Database update failed' });
  }
  res.status(200).json({ message: 'Plan proof uploaded', id: planId, fileName });
});


const walletProofStorage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, path.join(__dirname, 'uploads/walletProofs'));
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, 'walletProof-' + uniqueSuffix + path.extname(file.originalname));
  }
});


function generateUniqueUid(callback) {
  const tryGenerate = () => {
    const uid = generateUid();
    db.query(`SELECT COUNT(*) AS count FROM memberregistration WHERE Uid = ?`, [uid], (err, result) => {
      if (err) return callback(null);
      if (result[0].count === 0) {
        callback(uid);
      } else {
        tryGenerate();
      }
    });
  };
  tryGenerate();
}

app.post('/memberregistration', (req, res) => {
  const {
    registrationDateTime, userName, firstName, lastName, email, password,
    contactNumber, country, city, referralLink, plan, planAmount,
    status, approvedBy, approvedDateTime, paymentProofName
  } = req.body;

  const referralBaseUrl = "";
  const personalReferralLink = `${referralBaseUrl}?ref=${userName}`;
  const personalReferralID = userName;

  const checkUserSql = `SELECT * FROM memberregistration WHERE userName = ? OR email = ?`;


  const refID = referralLink ? referralLink.split("=")[1] : "";
  let PrimaryID = 0;
  let SecondaryID = 0;

  resolveReferralHierarchy(refID, () => {
    generateUniqueUid((uid) => {
      if (!uid) return sendError("Failed to generate UID");
      insertUser(uid);
    });
  });

  function resolveReferralHierarchy(refID, callback) {
    if (!refID) return callback();

    db.query(`SELECT id, referralLink FROM memberregistration WHERE userName = ?`, [refID], (err, refUserData) => {
      if (err) return sendError("Error fetching referral user info");

      if (refUserData.length > 0) {
        const refUser = refUserData[0];
        PrimaryID = refUser.id;

        const parentUserName = refUser.referralLink ? refUser.referralLink.split("=")[1] : null;

        if (parentUserName) {
          db.query(`SELECT id FROM memberregistration WHERE userName = ?`, [parentUserName], (err, parentUserData) => {
            if (err) return sendError("Error fetching parent referral info");

            if (parentUserData.length > 0) {
              PrimaryID = parentUserData[0].id;
              SecondaryID = refUser.id;
            }
            callback();
          });
        } else {
          callback();
        }
      } else {
        callback();
      }
    });
  }


  const values = [
    registrationDateTime, userName, firstName, lastName, email, password,
    contactNumber, country, city, refID, referralLink || "",
    personalReferralID, personalReferralLink, plan, planAmount, status,
    approvedBy, approvedDateTime, PrimaryID, paymentProofName || null, SecondaryID, uid
  ];

  db.query(insertSql, values, (err) => {
    if (err) return sendError("Error inserting member");
    insertCommission();
  });
}

    

      db.query(baseRowSql, baseRow, (err) => {
  if (err) return sendError("Error inserting base commission row");

  if (!refID) return sendWelcomeEmail();

  getUserNameById(SecondaryID || PrimaryID, (referrerUserName) => {
    if (!referrerUserName) return sendError("Referrer user not found");

    const referrerRow = [
      referrerUserName,
      personalReferralID,
      userName,
      planAmount * 0.80,
      SecondaryID ? planAmount * 0.10 : planAmount * 0.20,
      0.00
    ];

    db.query(baseRowSql, referrerRow, (err) => {
      if (err) return sendError("Error inserting referrer commission");

      if (SecondaryID) {
        getUserNameById(PrimaryID, (parentUserName) => {
          if (!parentUserName) return sendError("Parent user not found");

          const parentRow = [
            parentUserName,
            personalReferralID,
            userName,
            planAmount * 0.10,
            0.00,
            0.00
          ];

          db.query(baseRowSql, parentRow, (err) => {
            if (err) return sendError("Error inserting parent commission");

            insertIntoWallet(referrerUserName, planAmount * 0.80, "Referrer Commission");
            insertIntoWallet(userName, planAmount * 0.10, "Company Share");
            insertIntoWallet(parentUserName, planAmount * 0.10, "Parent Commission");

            sendWelcomeEmail();
          });
        });
      } else {
        insertIntoWallet(referrerUserName, planAmount * 0.80, "Referrer Commission");
        insertIntoWallet(userName, planAmount * 0.20, "Company Share");

        sendWelcomeEmail();
      }
    });
  });



  function getUserNameById(id, callback) {
    if (!id) return callback(null);

    db.query(`SELECT userName FROM memberregistration WHERE id = ?`, [id], (err, result) => {
      if (err || result.length === 0) return callback(null);
      callback(result[0].userName);
    });
  }

  function insertIntoWallet(userName, amount, source) {
    const walletInsertSql = `INSERT INTO member_wallet (userName, amount, source) VALUES (?, ?, ?)`;
    db.query(walletInsertSql, [userName, amount, source], (err) => {
      if (err) console.error("Wallet insert error:", err);
    });
  }

  function sendWelcomeEmail() {
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: '',
        pass: ''
      }
    });

    const mailOptions = {
      from: '',
      to: email,
      subject: 'Thank you for registering!',
      html: `
          <h3>Hello ${firstName},</h3>
          <p>Thank you for registering with us. Your account has been created successfully.</p>
          <p><strong>Username:</strong> ${userName}</p>
          <p><strong>Plan:</strong> ${plan}</p>
          <p><strong>Your Referral Link:</strong> <a href="${personalReferralLink}">${personalReferralLink}</a></p>
          <br/>
          <p>Best regards,<br/>Team</p>
        `
    };

    transporter.sendMail(mailOptions, (error) => {
      if (error) {
        console.error("Email send error:", error);
        return res.status(200).json({ message: "Member registered successfully, but email not sent" });
      } else {
        return res.status(200).json({ message: "Member registered successfully and email sent" });
      }
    });
  }

  function sendError(msg) {
    return res.status(500).json({ error: msg });
  }


  app.put('/memberregistration/password', (req, res) => {
    const { userName, oldPassword, newPassword, firstName, lastName } = req.body;

    if (!userName || !oldPassword || !newPassword) {
      return res.status(400).json({ error: "Missing required fields." });
    }

    const checkSql = `SELECT * FROM memberregistration WHERE userName = ? AND password = ?`;
    db.query(checkSql, [userName, oldPassword], (err, result) => {
      if (err) return res.status(500).json({ error: "Database error while validating user." });

      if (result.length === 0) {
        return res.status(400).json({ message: "Invalid username or old password." });
      }

      const updateFields = [];
      const values = [];

      // Conditionally update password
      if (newPassword) {
        updateFields.push("password = ?");
        values.push(newPassword);
      }

      // Conditionally update firstName and lastName
      if (firstName) {
        updateFields.push("firstName = ?");
        values.push(firstName);
      }
      if (lastName) {
        updateFields.push("lastName = ?");
        values.push(lastName);
      }

      values.push(userName);

      const updateSql = `UPDATE memberregistration SET ${updateFields.join(", ")} WHERE userName = ?`;
      db.query(updateSql, values, (err, updateResult) => {
        if (err) return res.status(500).json({ error: "Database error while updating fields." });

        return res.status(200).json({ message: "Profile updated successfully." });
      });
    });
  });
  // Update member's firstName and lastName by userName
  app.put('/memberregistration/updateName', (req, res) => {
    const { userName, firstName, lastName } = req.body;

    if (!userName || !firstName || !lastName) {
      return res.status(400).json({ error: "Missing required fields." });
    }

    const updateSql = `UPDATE memberregistration SET firstName = ?, lastName = ? WHERE userName = ?`;

    db.query(updateSql, [firstName, lastName, userName], (err, result) => {
      if (err) {
        return res.status(500).json({ error: "Database error while updating name." });
      }

      if (result.affectedRows === 0) {
        return res.status(404).json({ message: "User not found or no changes made." });
      }

      return res.status(200).json({ message: "Name updated successfully." });
    });
  });


  // app.post('/memberregistration', (req, res) => {
  //   const {
  //     registrationDateTime, userName, firstName, lastName, email, password,
  //     contactNumber, country, city, referralLink, plan, planAmount,
  //     status, approvedBy, approvedDateTime, paymentProofName
  //   } = req.body;

  //   const referralBaseUrl = "https://metalink.sysborgtech.com/";
  //   const personalReferralLink = `${referralBaseUrl}?ref=${userName}`;
  //   const personalReferralID = userName;

  //   const checkUserSql = `SELECT * FROM memberregistration WHERE userName = ? OR email = ?`;
  //   db.query(checkUserSql, [userName, email], (err, existingUsers) => {
  //     if (err) return res.status(500).json({ error: "Database error during validation" });
  //     if (existingUsers.length > 0) {
  //       return res.status(400).json({ message: "Username or Email already exists." });
  //     }

  //     const refID = referralLink ? referralLink.split("=")[1] : "";
  //     let PrimaryID = 0;
  //     let SecondaryID = 0;

  //     if (refID) {
  //       // 1st: Get the user info from referralLink
  //       db.query(
  //         `SELECT id, referralLink FROM memberregistration WHERE userName = ?`,
  //         [refID],
  //         (err, refUserData) => {
  //           if (err) return res.status(500).json({ error: "Error fetching referral user info" });

  //           if (refUserData.length > 0) {
  //             const refUser = refUserData[0];

  //             // Make refUser's id the PrimaryID initially
  //             PrimaryID = refUser.id;

  //             // 2nd: Check if refUser was also referred by someone else
  //             const refUserReferral = refUser.referralLink;
  //             const parentUserName = refUserReferral ? refUserReferral.split("=")[1] : null;

  //             if (parentUserName) {
  //               // Get the parent user's id
  //               db.query(
  //                 `SELECT id FROM memberregistration WHERE userName = ?`,
  //                 [parentUserName],
  //                 (err, parentUserData) => {
  //                   if (err) return res.status(500).json({ error: "Error fetching parent referral info" });

  //                   if (parentUserData.length > 0) {
  //                     PrimaryID = parentUserData[0].id; // Parent’s ID becomes new PrimaryID
  //                     SecondaryID = refUser.id; // Referred user's ID becomes SecondaryID
  //                   }
  //                   insertUser(); // call after second level check
  //                 }
  //               );
  //             } else {
  //               insertUser(); // No parent, so just proceed with first level
  //             }
  //           } else {
  //             insertUser(); // If no user found from referralLink
  //           }
  //         }
  //       );
  //     } else {
  //       insertUser(); // No referral used
  //     }

  //     function insertUser() {
  //       const insertSql = `
  //         INSERT INTO memberregistration (
  //           registrationDateTime, userName, firstName, lastName, email, password,
  //           contactNumber, country, city, referralID, referralLink,
  //           personalReferralID, personalReferralLink, plan, planAmount, status,
  //           approvedBy, approvedDateTime, PrimaryID, paymentProofName, SecondaryID
  //         ) VALUES (
  //           ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
  //         )
  //       `;

  //       const values = [
  //         registrationDateTime, userName, firstName, lastName, email, password,
  //         contactNumber, country, city, refID, referralLink || "",
  //         personalReferralID, personalReferralLink, plan, planAmount, status,
  //         approvedBy, approvedDateTime, PrimaryID, paymentProofName || null, SecondaryID
  //       ];

  //       db.query(insertSql, values, (err, result) => {
  //         if (err) {
  //           console.error("Error inserting member:", err);
  //           return res.status(500).json({ error: "Error inserting member" });
  //         }

  //         insertCommission();
  //       });
  //     }

  //     function insertCommission() {
  //       const baseRowSql = `
  //         INSERT INTO membercommission 
  //         (memberID, personalReferralID, referralID, memberCommission, companyShare, parentCommission) 
  //         VALUES (?, ?, ?, ?, ?, ?)
  //       `;

  //       // Helper function to get userName by ID
  //       function getUserNameById(id, callback) {
  //         db.query(`SELECT userName FROM memberregistration WHERE id = ?`, [id], (err, result) => {
  //           if (err || result.length === 0) return callback(null);
  //           return callback(result[0].userName);
  //         });
  //       }

  //       // Insert member's commission base row
  //       const baseRow = [
  //         userName,                // Correct memberID (as userName)
  //         personalReferralID,
  //         refID ? refID : "self",  // If no referral, use 'self'
  //         0.00,
  //         planAmount,
  //         0.00
  //       ];

  //       db.query(baseRowSql, baseRow, (err) => {
  //         if (err) {
  //           console.error("Error inserting base commission row:", err);
  //           return res.status(500).json({ error: "Error inserting commission base row" });
  //         }

  //         if (!refID) {
  //           return sendWelcomeEmail();  // No referral, done after first insert
  //         }

  //         // Now insert row for the REFERRER (SecondaryID or PrimaryID depending)
  //         getUserNameById(SecondaryID || PrimaryID, (referrerUserName) => {
  //           if (!referrerUserName) {
  //             console.error("Could not find referrer username");
  //             return res.status(500).json({ error: "Referrer user not found" });
  //           }

  //           const referrerRow = [
  //             referrerUserName,            // Corrected memberID (as username)
  //             personalReferralID,
  //             userName,
  //             planAmount * 0.80,           // 80% for the referrer
  //             SecondaryID ? planAmount * 0.10 : planAmount * 0.20,  // Company share
  //             0.00
  //           ];

  //           db.query(baseRowSql, referrerRow, (err) => {
  //             if (err) {
  //               console.error("Error inserting referrer commission row:", err);
  //               return res.status(500).json({ error: "Error inserting referrer commission" });
  //             }

  //             // If we have a parent (SecondaryID exists), add 3rd level commission
  //             if (SecondaryID) {
  //               getUserNameById(PrimaryID, (parentUserName) => {
  //                 if (!parentUserName) {
  //                   console.error("Could not find parent username");
  //                   return res.status(500).json({ error: "Parent user not found" });
  //                 }

  //                 const parentRow = [
  //                   parentUserName,         // Corrected memberID (as username)
  //                   personalReferralID,
  //                   userName,
  //                   planAmount * 0.10,      // 10% for the parent
  //                   0.00,
  //                   0.00
  //                 ];

  //                 db.query(baseRowSql, parentRow, (err) => {
  //                   if (err) {
  //                     console.error("Error inserting parent commission row:", err);
  //                     return res.status(500).json({ error: "Error inserting parent commission" });
  //                   }

  //                   return sendWelcomeEmail();
  //                 });
  //               });
  //             } else {
  //               return sendWelcomeEmail();
  //             }
  //           });
  //         });
  //       });
  //     }

  //     function sendWelcomeEmail() {
  //       const transporter = nodemailer.createTransport({
  //         service: 'gmail',
  //         auth: {
  //           user: 'umairsysborg@gmail.com',
  //           pass: 'yyieyymfefaroxsd'
  //         }
  //       });

  //       const mailOptions = {
  //         from: 'umairsysborg@gmail.com',
  //         to: email,
  //         subject: 'Thank you for registering!',
  //         html: `
  //           <h3>Hello ${firstName},</h3>
  //           <p>Thank you for registering with us. Your account has been created successfully.</p>
  //           <p><strong>Username:</strong> ${userName}</p>
  //           <p><strong>Plan:</strong> ${plan}</p>
  //           <p><strong>Your Referral Link:</strong> <a href="${personalReferralLink}">${personalReferralLink}</a></p>
  //           <br/>
  //           <p>Best regards,<br/>Team</p>
  //         `
  //       };

  //       transporter.sendMail(mailOptions, (error, info) => {
  //         if (error) {
  //           console.error("Email send error:", error);
  //           return res.status(200).json({
  //             message: "Member registered successfully, but email not sent"
  //           });
  //         } else {
  //           return res.status(200).json({
  //             message: "Member registered successfully and email sent"
  //           });
  //         }
  //       });
  //     }
  //   });
  // });


  // Assuming you have a database connection setup in `db`

  app.get('/api/commissions', (req, res) => {
    const sql = `
    SELECT 
      mc.id,
      mc.memberID,
      mc.personalReferralID,
      mc.referralID,
      mc.memberCommission,
      mc.companyShare,
      mc.parentCommission,
      mr.firstName,
      mr.lastName,
      mr.approvedBy,
      mr.status,
      mr.registrationDateTime,
      mp.plan,                    -- latest plan
      mp.plan_Amount,
      mp.date as planDate
    FROM membercommission mc
    INNER JOIN memberregistration mr ON mc.memberID = mr.userName
    LEFT JOIN (
      SELECT mp1.user_Name, mp1.plan, mp1.plan_Amount, mp1.date
      FROM member_plan mp1
      INNER JOIN (
        SELECT user_Name, MAX(date) as maxDate
        FROM member_plan
        GROUP BY user_Name
      ) mp2 ON mp1.user_Name = mp2.user_Name AND mp1.date = mp2.maxDate
    ) mp ON mc.memberID = mp.user_Name
  `;

    db.query(sql, (err, results) => {
      if (err) {
        console.error("Error fetching commissions:", err);
        return res.status(500).json({ error: "Database error" });
      }
      res.json(results);
    });
  });








  // Backend Route to Get Commissions for Logged-in User



  app.post("/commissions", (req, res) => {
    const { memberID, personalReferralID, referralID, memberCommission, companyShare } = req.body;

    const sql = "INSERT INTO membercommission (`memberID`, `personalReferralID`, `referralID`, `memberCommission`,`companyShare`) VALUES (?, ?, ?, ?,?)";
    const values = [memberID, personalReferralID, referralID, memberCommission, companyShare];

    db.query(sql, values, (err, data) => {
      if (err) {
        console.error("Error inserting commission:", err);
        return res.status(500).json({ message: "Error inserting commission", error: err });
      }
      return res.status(201).json({ message: "Commission inserted successfully", commissionID: data.insertId });
    });
  });

  app.get("/commissions", (req, res) => {
    const sql = "SELECT * FROM membercommission";

    db.query(sql, (err, data) => {
      if (err) {
        console.error("Error fetching packages:", err);
        return res.status(500).json({ message: "Error fetching packages", error: err });
      }
      return res.status(200).json(data);
    });
  });

  // POST /memberlogin
  // MEMBER LOGIN ROUTE
  // app.post('/memberlogin', (req, res) => {
  //     const { identifier, password } = req.body;

  //     const sql = `
  //         SELECT * FROM memberregistration 
  //         WHERE (email = ? OR userName = ?) AND password = ?
  //     `;

  //     db.query(sql, [identifier, identifier, password], (err, result) => {
  //         if (err) {
  //             console.error("Login error:", err);
  //             return res.status(500).json({ error: "Internal Server Error" });
  //         }

  //         if (result.length === 0) {
  //             return res.status(401).json({ message: "Invalid credentials" });
  //         }

  //         const user = result[0];

  //         if (user.status === "pending") {
  //             return res.status(403).json({ message: "Your registration is still pending approval." });
  //         }

  //         if (user.status === "reject") {
  //             return res.status(403).json({ message: "Your registration has been rejected." });
  //         }

  //         delete user.password;

  //         return res.status(200).json({
  //             message: "Login successful",
  //             user
  //         });
  //     });
  // });

  app.post('/memberlogin', (req, res) => {
    const { identifier, password } = req.body;

    const sql = `
      SELECT * FROM memberregistration 
      WHERE (email = ? OR userName = ?) AND password = ?
  `;

    db.query(sql, [identifier, identifier, password], (err, result) => {
      if (err) {
        console.error("Login error:", err);
        return res.status(500).json({ error: "Internal Server Error" });
      }

      if (result.length === 0) {
        return res.status(401).json({ message: "Invalid credentials" });
      }

      const user = result[0];

      // Optional: Remove password before sending response
      delete user.password;

      return res.status(200).json({
        message: "Login successful",
        user
      });
    });
  });




  app.put('/memberregistration/:id/status', (req, res) => {
    const { status } = req.body;
    const memberId = req.params.id;

    const sql = `UPDATE memberregistration SET status = ? WHERE id = ?`;

    db.query(sql, [status, memberId], (err, result) => {
      if (err) {
        console.error("Error updating status:", err);
        return res.status(500).json({ error: "Failed to update status" });
      }

      res.status(200).json({ message: "Status updated successfully", result });
    });
  });


  app.get('/memberregistration', (req, res) => {
    const sql = `SELECT * FROM memberregistration`;

    db.query(sql, (err, data) => {
      if (err) {
        console.error("Error fetching member registrations:", err);
        return res.status(500).json({ error: "Internal Server Error" });
      }
      return res.status(200).json({ data });
    });
  });

  // INSERT package
  app.post("/packages", (req, res) => {
    const { packageName, amount, status } = req.body;

    const sql = "INSERT INTO packages (`packageName`, `amount`, `status`) VALUES (?, ?, ?)";
    const values = [packageName, amount, status];

    db.query(sql, values, (err, data) => {
      if (err) {
        console.error("Error inserting package:", err);
        return res.status(500).json({ message: "Error inserting package", error: err });
      }
      return res.status(201).json({ message: "Package inserted successfully", packageID: data.insertId });
    });
  });

  // GET all packages
  app.get("/packages", (req, res) => {
    const sql = "SELECT * FROM packages";

    db.query(sql, (err, data) => {
      if (err) {
        console.error("Error fetching packages:", err);
        return res.status(500).json({ message: "Error fetching packages", error: err });
      }
      return res.status(200).json(data);
    });
  });

  // UPDATE package by ID
  app.put("/packages/:id", (req, res) => {
    const { id } = req.params;
    const { packageName, amount, status } = req.body;

    const sql = `
    UPDATE packages 
    SET packageName = ?, amount = ?, status = ?
    WHERE id = ?
  `;
    const values = [packageName, amount, status, id];

    db.query(sql, values, (err, result) => {
      if (err) {
        console.error("Error updating package:", err);
        return res.status(500).json({ message: "Error updating package", error: err });
      }
      return res.status(200).json({ message: "Package updated successfully" });
    });
  });



  app.post("/users", (req, res) => {
    const sql = "INSERT INTO users (`userName`, `emailID`, `userRole`, `userPassword`) VALUES (?, ?, ?, ?)";
    const values = [req.body.userName, req.body.emailID, req.body.userRole, req.body.userPassword];

    db.query(sql, values, (err, data) => {
      if (err) {
        console.error(err); // Log the error for debugging
        return res.status(500).json({ message: "Error inserting user", error: err });
      }
      return res.status(201).json({ userID: data.insertId }); // Return the new user ID
    });
  });

  app.post("/login", (req, res) => {
    const { emailID, userPassword } = req.body;

    const sql = "SELECT * FROM users WHERE emailID = ? AND userPassword = ?";
    const values = [emailID, userPassword];

    db.query(sql, values, (err, results) => {
      if (err) {
        console.error("Database error:", err);
        return res.status(500).json({ message: "Internal server error", error: err });
      }

      if (results.length > 0) {
        // User found
        const user = results[0];
        return res.status(200).json({
          message: "Login successful",
          user: {
            id: user.id,            // Adjust if your user ID column has a different name
            userName: user.userName,
            emailID: user.emailID,
            userRole: user.userRole
          }
        });
      } else {
        // No user found
        return res.status(401).json({ message: "Invalid email or password" });
      }
    });
  });

  app.post('/member_wallet', (req, res) => {
    const sql = "INSERT INTO member_wallet (`date`, `wallet`, `userName`) VALUES (?, ?, ?)";
    const values = [req.body.date, req.body.wallet, req.body.userName];

    db.query(sql, values, (err, data) => {
      if (err) {
        console.error(err); // Log the error for debugging
        return res.status(500).json({ message: "Error inserting data into member_wallet", error: err });
      }
      return res.status(201).json({ walletID: data.insertId }); // Return the new wallet ID
    });
  });
  app.get('/member_wallet', (req, res) => {
    const sql = "SELECT * FROM member_wallet";

    db.query(sql, (err, data) => {
      if (err) {
        console.error(err); // Error ko console mein print karo
        return res.status(500).json({ message: "Error fetching data from member_wallet", error: err });
      }
      console.log("Data fetched from database:", data); // Check the data being returned
      return res.status(200).json(data); // Saari rows ko return karo
    });
  });


  // app.post('/member_plan', (req, res) => {
  //   const sql = "INSERT INTO member_plan (`user_Name`, `plan`, `plan_Amount`, `date`) VALUES (?, ?, ?, ?)";
  //   const values = [req.body.user_Name, req.body.plan, req.body.plan_Amount, req.body.date];

  //   db.query(sql, values, (err, data) => {
  //     if (err) {
  //       console.error(err); // Log the error for debugging
  //       return res.status(500).json({ message: "Error inserting data into member_plan", error: err });
  //     }
  //     return res.status(201).json({ planID: data.insertId }); // Return the new plan ID
  //   });
  // });


  // app.post('/purchase_plan', (req, res) => {
  //   const { user_Name, plan, plan_Amount, date } = req.body;

  //   const getBalanceSql = "SELECT SUM(wallet) AS balance FROM member_wallet WHERE userName = ?";
  //   db.query(getBalanceSql, [user_Name], (err, result) => {
  //     if (err) return res.status(500).json({ message: "Error checking wallet", error: err });

  //     const balance = result[0].balance || 0;

  //     if (balance < plan_Amount) {
  //       return res.status(400).json({ message: "Insufficient balance" });
  //     }

  //     // Insert into member_plan
  //     const insertPlanSql = "INSERT INTO member_plan (`user_Name`, `plan`, `plan_Amount`, `date`) VALUES (?, ?, ?, ?)";
  //     const planValues = [user_Name, plan, plan_Amount, date];
  //     db.query(insertPlanSql, planValues, (err, planResult) => {
  //       if (err) return res.status(500).json({ message: "Error inserting plan", error: err });

  //       // Deduct from wallet (by inserting a negative wallet entry)
  //       const deductWalletSql = "INSERT INTO member_wallet (`date`, `wallet`, `userName`) VALUES (?, ?, ?)";
  //       const walletValues = [date, -plan_Amount, user_Name];
  //       db.query(deductWalletSql, walletValues, (err, walletResult) => {
  //         if (err) return res.status(500).json({ message: "Error deducting from wallet", error: err });

  //         return res.status(201).json({ message: "Plan purchased successfully", planID: planResult.insertId });
  //       });
  //     });
  //   });
  // });

  //   app.post('/purchase_plan', (req, res) => {
  //     const { user_Name, plan, plan_Amount, date } = req.body;

  //     // Step 1: Insert into member_plan
  //     const insertPlanSql = `
  //       INSERT INTO member_plan (user_Name, plan, plan_Amount, date)
  //       VALUES (?, ?, ?, ?)
  //     `;

  //     db.query(insertPlanSql, [user_Name, plan, plan_Amount, date], (err, result) => {
  //       if (err) {
  //         console.error("Error inserting into member_plan:", err);
  //         return res.status(500).json({ error: "Failed to insert member plan" });
  //       }

  //       // Step 2: Deduct from the user's wallet (insert negative amount)
  //       console.log(`Attempting to deduct ${plan_Amount} from ${user_Name}'s wallet on ${date}`);
  //       insertWallet(user_Name, -plan_Amount, "Plan Purchase", date);

  //       // Step 3: Get referral information
  //       const getRefInfoSql = `
  //         SELECT id, PrimaryID, SecondaryID FROM memberregistration WHERE userName = ?
  //       `;
  //       db.query(getRefInfoSql, [user_Name], (err, result) => {
  //         if (err || result.length === 0) {
  //           console.error("Error fetching referral info:", err);
  //           return res.status(500).json({ error: "User not found or referral info missing" });
  //         }

  //         const memberID = result[0].id;
  //         const PrimaryID = result[0].PrimaryID;
  //         const SecondaryID = result[0].SecondaryID;

  //         const insertCommissionSql = `
  //           INSERT INTO membercommission (memberID, personalReferralID, referralID, memberCommission, companyShare, parentCommission)
  //           VALUES (?, ?, ?, ?, ?, ?)
  //         `;

  //         // Step 4: Insert base commission for the user (self)
  //         const baseRow = [memberID, user_Name, "self", 0.00, plan_Amount, 0.00];
  //         db.query(insertCommissionSql, baseRow, (err) => {
  //           if (err) {
  //             console.error("Error inserting base commission:", err);
  //             return res.status(500).json({ error: "Failed to insert base commission" });
  //           }
  //         });

  //         const referrerID = SecondaryID || PrimaryID;

  //         if (referrerID) {
  //           // Step 5: Handle referral commissions
  //           db.query(`SELECT userName FROM memberregistration WHERE id = ?`, [referrerID], (err, refResult) => {
  //             if (err || refResult.length === 0) {
  //               console.error("Error fetching referrer userName:", err);
  //               return res.status(500).json({ error: "Referrer not found" });
  //             }

  //             const referrerUserName = refResult[0].userName;
  //             const referrerCommission = plan_Amount * 0.80;
  //             const companyShare = SecondaryID ? plan_Amount * 0.10 : plan_Amount * 0.20;

  //             const referrerRow = [
  //               referrerUserName, user_Name, user_Name,
  //               referrerCommission,
  //               companyShare,
  //               0.00
  //             ];

  //             db.query(insertCommissionSql, referrerRow, (err) => {
  //               if (err) {
  //                 console.error("Error inserting referrer commission:", err);
  //                 return res.status(500).json({ error: "Failed to insert referrer commission" });
  //               }

  //               // Step 6: Deduct commission from referrer’s wallet
  //               insertWallet(referrerUserName, referrerCommission, "Referrer Commission", date);
  //             });

  //             // Step 7: If SecondaryID exists, insert parent commission too
  //             if (SecondaryID) {
  //               db.query(`SELECT userName FROM memberregistration WHERE id = ?`, [PrimaryID], (err, parentRes) => {
  //                 if (err || parentRes.length === 0) {
  //                   console.error("Parent user not found");
  //                   return res.status(500).json({ error: "Parent user not found" });
  //                 }

  //                 const parentUserName = parentRes[0].userName;
  //                 const parentCommissionAmount = plan_Amount * 0.10;
  //                 const parentRow = [
  //                   parentUserName, user_Name, user_Name,
  //                   parentCommissionAmount,
  //                   0.00,
  //                   0.00
  //                 ];

  //                 db.query(insertCommissionSql, parentRow, (err) => {
  //                   if (err) {
  //                     console.error("Failed to insert parent commission:", err);
  //                     return res.status(500).json({ error: "Failed to insert parent commission" });
  //                   }

  //                   // Step 8: Deduct commission from parent’s wallet
  //                   insertWallet(parentUserName, parentCommissionAmount, "Parent Commission", date);

  //                   // Final response
  //                   return res.status(200).json({ message: "Plan, commissions, and wallets recorded successfully" });
  //                 });
  //               });
  //             } else {
  //               return res.status(200).json({ message: "Plan and referrer commission recorded" });
  //             }
  //           });
  //         } else {
  //           return res.status(200).json({ message: "Plan inserted. No referrer found." });
  //         }
  //       });
  //     });

  //     // Insert wallet entry (positive or negative)
  //     function insertWallet(userName, amount, source, date) {
  //       const sql = `INSERT INTO member_wallet (date, wallet, userName) VALUES (?, ?, ?)`;
  //       db.query(sql, [date, amount, userName], (err, result) => {
  //         if (err) {
  //           console.error("Wallet insert error:", err);
  //           return;
  //         }
  //         console.log(`Wallet entry created: ${amount} for ${userName} from ${source}`);
  //       });
  //     }

  //  }); 
  app.post('/purchase_plan', (req, res) => {
    const { user_Name, plan, plan_Amount, date } = req.body;

    // Step 0: Get last plan amount
    const getLastPlanSql = `SELECT plan_Amount FROM member_plan WHERE user_Name = ? ORDER BY id DESC LIMIT 1`;

    db.query(getLastPlanSql, [user_Name], (err, lastResult) => {
      if (err) {
        return res.status(500).json({ error: "Failed to fetch last plan" });
      }

      let oldPlanAmount = 0;
      if (lastResult.length > 0) {
        oldPlanAmount = lastResult[0].plan_Amount;
        if (plan_Amount <= oldPlanAmount) {
          return res.status(400).json({ error: "Upgrade should be to a higher plan only." });
        }
      }

      const netAmountToDeduct = plan_Amount - oldPlanAmount;

      // Step 0.5: Fetch commission rates from advanceoption table
      const commissionSql = `SELECT * FROM advanceoption ORDER BY id ASC`;
      db.query(commissionSql, (err, rates) => {
        if (err) {
          return res.status(500).json({ error: "Failed to fetch commission rates" });
        }

        // Assuming ids: 1 = self, 2 = referral, 3 = parent (as your table data suggest)
        // Create a map for easier access:
        const commissionMap = {};
        rates.forEach(row => {
          commissionMap[row.id] = row;
        });

        // Insert new plan record
        const insertPlanSql = `INSERT INTO member_plan (user_Name, plan, plan_Amount, date) VALUES (?, ?, ?, ?)`;
        db.query(insertPlanSql, [user_Name, plan, plan_Amount, date], (err, result) => {
          if (err) {
            return res.status(500).json({ error: "Failed to insert plan" });
          }

          // Deduct net amount from user's wallet
          insertWallet(user_Name, -netAmountToDeduct, "Plan Upgrade", date);

          // Fetch referral info for user
          const getRefInfoSql = `SELECT id, PrimaryID, SecondaryID FROM memberregistration WHERE userName = ?`;
          db.query(getRefInfoSql, [user_Name], (err, userResult) => {
            if (err || userResult.length === 0) {
              return res.status(500).json({ error: "User not found or referral info missing" });
            }

            const memberID = userResult[0].id;
            const PrimaryID = userResult[0].PrimaryID;
            const SecondaryID = userResult[0].SecondaryID;

            const insertCommissionSql = `
            INSERT INTO membercommission (memberID, personalReferralID, referralID, memberCommission, companyShare, parentCommission)
            VALUES (?, ?, ?, ?, ?, ?)
          `;

            // Self commission (id=1)
            const selfCommission = commissionMap[1] || { system: 0, upline: 0, commition: 0 };
            const selfRow = [
              memberID, user_Name, "self",
              (netAmountToDeduct * selfCommission.commition) / 100,
              (netAmountToDeduct * selfCommission.system) / 100,
              0
            ];

            db.query(insertCommissionSql, selfRow, (err) => {
              if (err) return res.status(500).json({ error: "Failed to insert self commission" });
            });

            // Referral commission (id=2)
            const referrerID = SecondaryID || PrimaryID;

            if (referrerID) {
              db.query(`SELECT userName FROM memberregistration WHERE id = ?`, [referrerID], (err, refResult) => {
                if (err || refResult.length === 0) {
                  return res.status(500).json({ error: "Referrer not found" });
                }

                const referrerUserName = refResult[0].userName;
                const refCommission = commissionMap[2] || { system: 0, upline: 0, commition: 0 };

                const referrerRow = [
                  referrerUserName, user_Name, user_Name,
                  (netAmountToDeduct * refCommission.commition) / 100,
                  (netAmountToDeduct * refCommission.system) / 100,
                  0
                ];

                db.query(insertCommissionSql, referrerRow, (err) => {
                  if (err) return res.status(500).json({ error: "Failed to insert referral commission" });

                  insertWallet(referrerUserName, (netAmountToDeduct * refCommission.commition) / 100, "Referral Commission", date);
                });

                // Parent commission (id=3) if SecondaryID exists
                if (SecondaryID) {
                  db.query(`SELECT userName FROM memberregistration WHERE id = ?`, [PrimaryID], (err, parentRes) => {
                    if (err || parentRes.length === 0) {
                      return res.status(500).json({ error: "Parent user not found" });
                    }

                    const parentUserName = parentRes[0].userName;
                    const parentCommission = commissionMap[3] || { system: 0, upline: 0, commition: 0 };

                    const parentRow = [
                      parentUserName, user_Name, user_Name,
                      (netAmountToDeduct * parentCommission.upline) / 100,
                      0,
                      0
                    ];

                    db.query(insertCommissionSql, parentRow, (err) => {
                      if (err) return res.status(500).json({ error: "Failed to insert parent commission" });

                      insertWallet(parentUserName, (netAmountToDeduct * parentCommission.upline) / 100, "Parent Commission", date);

                      return res.status(200).json({ message: "Plan upgraded successfully with commissions" });
                    });
                  });
                } else {
                  return res.status(200).json({ message: "Plan upgraded with referral commission" });
                }
              });
            } else {
              return res.status(200).json({ message: "Plan upgraded with no referrer" });
            }
          });
        });

        function insertWallet(userName, amount, source, date) {
          const sql = `INSERT INTO member_wallet (date, wallet, userName) VALUES (?, ?, ?)`;
          db.query(sql, [date, amount, userName], (err) => {
            if (err) console.error("Wallet insert error:", err);
            else console.log(`Wallet updated for ${userName}: ${amount} from ${source}`);
          });
        }
      });
    });
  });

  // app.post('/purchase_plan', (req, res) => {
  //   const { user_Name, plan, plan_Amount, date } = req.body;

  //   // Step 0: Check user's last plan
  //   const getLastPlanSql = `SELECT plan_Amount FROM member_plan WHERE user_Name = ? ORDER BY id DESC LIMIT 1`;
  //   db.query(getLastPlanSql, [user_Name], (err, lastResult) => {
  //     if (err) {
  //       console.error("Error fetching last plan:", err);
  //       return res.status(500).json({ error: "Failed to fetch last plan" });
  //     }

  //     let oldPlanAmount = 0;
  //     if (lastResult.length > 0) {
  //       oldPlanAmount = lastResult[0].plan_Amount;

  //       // If new plan is not greater, block the upgrade
  //       if (plan_Amount <= oldPlanAmount) {
  //         return res.status(400).json({ error: "Upgrade should be to a higher plan only." });
  //       }
  //     }

  //     // Only the difference is to be charged
  //     const netAmountToDeduct = plan_Amount - oldPlanAmount;

  //     // Step 1: Insert into member_plan
  //     const insertPlanSql = `
  //         INSERT INTO member_plan (user_Name, plan, plan_Amount, date)
  //         VALUES (?, ?, ?, ?)
  //       `;

  //     db.query(insertPlanSql, [user_Name, plan, plan_Amount, date], (err, result) => {
  //       if (err) {
  //         console.error("Error inserting into member_plan:", err);
  //         return res.status(500).json({ error: "Failed to insert member plan" });
  //       }

  //       // Step 2: Deduct net amount from wallet
  //       insertWallet(user_Name, -netAmountToDeduct, "Plan Upgrade", date);

  //       // Step 3: Get referral info
  //       const getRefInfoSql = `
  //           SELECT id, PrimaryID, SecondaryID FROM memberregistration WHERE userName = ?
  //         `;
  //       db.query(getRefInfoSql, [user_Name], (err, result) => {
  //         if (err || result.length === 0) {
  //           console.error("Error fetching referral info:", err);
  //           return res.status(500).json({ error: "User not found or referral info missing" });
  //         }

  //         const memberID = result[0].id;
  //         const PrimaryID = result[0].PrimaryID;
  //         const SecondaryID = result[0].SecondaryID;

  //         const insertCommissionSql = `
  //             INSERT INTO membercommission (memberID, personalReferralID, referralID, memberCommission, companyShare, parentCommission)
  //             VALUES (?, ?, ?, ?, ?, ?)
  //           `;

  //         // Step 4: Insert base commission
  //         const baseRow = [memberID, user_Name, "self", 0.00, netAmountToDeduct, 0.00];
  //         db.query(insertCommissionSql, baseRow, (err) => {
  //           if (err) {
  //             console.error("Error inserting base commission:", err);
  //             return res.status(500).json({ error: "Failed to insert base commission" });
  //           }
  //         });

  //         const referrerID = SecondaryID || PrimaryID;

  //         if (referrerID) {
  //           // Step 5: Handle referrer
  //           db.query(`SELECT userName FROM memberregistration WHERE id = ?`, [referrerID], (err, refResult) => {
  //             if (err || refResult.length === 0) {
  //               console.error("Referrer not found");
  //               return res.status(500).json({ error: "Referrer not found" });
  //             }

  //             const referrerUserName = refResult[0].userName;
  //             const referrerCommission = netAmountToDeduct * 0.80;
  //             const companyShare = SecondaryID ? netAmountToDeduct * 0.10 : netAmountToDeduct * 0.20;

  //             const referrerRow = [
  //               referrerUserName, user_Name, user_Name,
  //               referrerCommission,
  //               companyShare,
  //               0.00
  //             ];

  //             db.query(insertCommissionSql, referrerRow, (err) => {
  //               if (err) {
  //                 console.error("Failed to insert referrer commission:", err);
  //                 return res.status(500).json({ error: "Failed to insert referrer commission" });
  //               }

  //               insertWallet(referrerUserName, referrerCommission, "Referrer Commission", date);
  //             });

  //             // Step 6: Parent commission (only if SecondaryID exists)
  //             if (SecondaryID) {
  //               db.query(`SELECT userName FROM memberregistration WHERE id = ?`, [PrimaryID], (err, parentRes) => {
  //                 if (err || parentRes.length === 0) {
  //                   console.error("Parent not found");
  //                   return res.status(500).json({ error: "Parent user not found" });
  //                 }

  //                 const parentUserName = parentRes[0].userName;
  //                 const parentCommissionAmount = netAmountToDeduct * 0.10;

  //                 const parentRow = [
  //                   parentUserName, user_Name, user_Name,
  //                   parentCommissionAmount,
  //                   0.00,
  //                   0.00
  //                 ];

  //                 db.query(insertCommissionSql, parentRow, (err) => {
  //                   if (err) {
  //                     console.error("Failed to insert parent commission:", err);
  //                     return res.status(500).json({ error: "Failed to insert parent commission" });
  //                   }

  //                   insertWallet(parentUserName, parentCommissionAmount, "Parent Commission", date);
  //                   return res.status(200).json({ message: "Plan upgraded successfully with commissions" });
  //                 });
  //               });
  //             } else {
  //               return res.status(200).json({ message: "Plan upgraded. Referrer commission given." });
  //             }
  //           });
  //         } else {
  //           return res.status(200).json({ message: "Plan upgraded. No referrer found." });
  //         }
  //       });
  //     });

  //     function insertWallet(userName, amount, source, date) {
  //       const sql = `INSERT INTO member_wallet (date, wallet, userName) VALUES (?, ?, ?)`;
  //       db.query(sql, [date, amount, userName], (err) => {
  //         if (err) {
  //           console.error("Wallet insert error:", err);
  //         } else {
  //           console.log(`Wallet entry: ${amount} for ${userName} from ${source}`);
  //         }
  //       });
  //     }
  //   });
  // });


  // GET: Fetch latest plans per user
  app.get('/users-with-latest-plan', (req, res) => {
    const sql = `
    SELECT 
      m.userName,
      m.email,
      p.plan,
      p.plan_Amount,
      p.date
    FROM memberregistration m
    INNER JOIN (
      SELECT user_Name, plan, plan_Amount, date
      FROM member_plan
      WHERE (user_Name, date) IN (
        SELECT user_Name, MAX(date)
        FROM member_plan
        GROUP BY user_Name
      )
    ) p ON m.userName = p.user_Name;
  `;

    db.query(sql, (err, results) => {
      if (err) return res.status(500).json({ error: "Database error", details: err });
      res.json(results);
    });
  });

  // ✅ PUT: Update latest plan for user
  app.put('/update-latest-plan/:userName', (req, res) => {
    const { userName } = req.params;
    const { plan, plan_Amount } = req.body;

    const sql = `
    UPDATE member_plan
    SET plan = ?, plan_Amount = ?
    WHERE user_Name = ? AND date = (
      SELECT MAX(date) FROM member_plan WHERE user_Name = ?
    )
  `;

    db.query(sql, [plan, plan_Amount, userName, userName], (err, result) => {
      if (err) return res.status(500).json({ error: "Database error", details: err });
      res.json({ message: "Plan updated successfully" });
    });
  });




  app.get('/purchase_plan', (req, res) => {
    const { user_Name } = req.query;

    let sql = "SELECT * FROM member_plan";
    const params = [];

    // If user_Name is provided, filter the query
    if (user_Name) {
      sql += " WHERE user_Name = ?";
      params.push(user_Name);
    }

    db.query(sql, params, (err, results) => {
      if (err) {
        return res.status(500).json({ message: "Error fetching plans", error: err });
      }

      res.status(200).json(results);
    });
  });

  app.get('/wallet_balance/:userName', (req, res) => {
    const userName = req.params.userName;

    const sql = "SELECT SUM(wallet) AS balance FROM member_wallet WHERE userName = ?";

    db.query(sql, [userName], (err, result) => {
      if (err) {
        console.error("Error fetching wallet balance:", err);
        return res.status(500).json({ message: "Error fetching wallet balance", error: err });
      }

      const balance = result[0].balance || 0; // fallback to 0 if null
      return res.status(200).json({ userName, balance });
    });
  });


  //   app.get('/getcommissions', (req, res) => {
  //     const sql = `SELECT * FROM membercommission`;

  //     db.query(sql, (err, data) => {
  //         if (err) {
  //             console.error("Error fetching member registrations:", err);
  //             return res.status(500).json({ error: "Internal Server Error" });
  //         }
  //         return res.status(200).json({ data });
  //     });
  // });
  app.post("/advanceoption", (req, res) => {
    const { system, upline, commition } = req.body;

    const sql = "INSERT INTO advanceoption (`system`, `upline`, `commition`) VALUES (?, ?, ?)";
    const values = [system, upline, commition];

    db.query(sql, values, (err, data) => {
      if (err) {
        console.error("Error inserting commission:", err);
        return res.status(500).json({ message: "Error inserting commission", error: err });
      }
      return res.status(201).json({ message: "Commission inserted successfully", commissionID: data.insertId });
    });
  });

  app.put("/advanceoption/:id", (req, res) => {
    const { id } = req.params;
    const { system, upline, commition } = req.body;
    const sql = "UPDATE advanceoption SET system = ?, upline = ?, commition = ? WHERE id = ?";
    const values = [system, upline, commition, id];

    db.query(sql, values, (err, data) => {
      if (err) {
        console.error("Update error:", err);
        return res.status(500).json({ message: "Update failed" });
      }
      res.json({ id: parseInt(id), system, upline, commition });
    });
  });

  app.delete("/advanceoption/:id", (req, res) => {
    const { id } = req.params;
    const sql = "DELETE FROM advanceoption WHERE id = ?";

    db.query(sql, [id], (err, data) => {
      if (err) {
        console.error("Delete error:", err);
        return res.status(500).json({ message: "Delete failed" });
      }
      res.json({ id: parseInt(id) });
    });
  });
  app.get("/advanceoption", (req, res) => {
    const sql = "SELECT * FROM advanceoption";
    db.query(sql, (err, data) => {
      if (err) {
        console.error("Error fetching advance options:", err);
        return res.status(500).json({ message: "Error fetching data", error: err });
      }
      return res.status(200).json(data);
    });
  });



  app.post('/send-email', async (req, res) => {
    const { name, email, subject, message } = req.body;

    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: 'umairsysborg@gmail.com',
        pass: 'yyieyymfefaroxsd'
      },
    });



    try {
      await transporter.sendMail(mailOptions);
      res.status(200).json({ message: 'Email sent successfully!' });
    } catch (error) {
      console.error('Email sending failed:', error);
      res.status(500).json({ message: 'Failed to send email', error });
    }
  });



  app.post('/transferFunds', (req, res) => {
    const { senderUid, receiverUid, amount } = req.body;

    if (!senderUid || !receiverUid || !amount || amount <= 0) {
      return res.status(400).json({ error: "Invalid input data" });
    }

    const sql = `SELECT userName, Uid FROM memberregistration WHERE Uid IN (?, ?)`;

    db.query(sql, [senderUid, receiverUid], (err, results) => {
      if (err) return res.status(500).json({ error: "Database error resolving UIDs" });
      if (results.length !== 2) {
        return res.status(400).json({ error: "Invalid UIDs provided" });
      }

      const sender = results.find(u => String(u.Uid) === String(senderUid));
      const receiver = results.find(u => String(u.Uid) === String(receiverUid));

      if (!sender || !receiver) {
        return res.status(400).json({ error: "Could not resolve sender or receiver" });
      }

      const senderUserName = sender.userName;
      const receiverUserName = receiver.userName;

      const balanceSql = `SELECT SUM(wallet) AS balance FROM member_wallet WHERE userName = ?`;

      db.query(balanceSql, [senderUserName], (err, result) => {
        if (err) return res.status(500).json({ error: "Error checking wallet balance" });

        const senderBalance = result[0].balance || 0;
        if (senderBalance < amount) {
          return res.status(400).json({ error: "Insufficient balance" });
        }

        const now = new Date();

        const walletSql = `INSERT INTO member_wallet (date, wallet, userName) VALUES (?, ?, ?)`;

        db.query(walletSql, [now, -amount, senderUserName], (err) => {
          if (err) return res.status(500).json({ error: "Error debiting sender wallet" });

          db.query(walletSql, [now, amount, receiverUserName], (err) => {
            if (err) return res.status(500).json({ error: "Error crediting receiver wallet" });

            const transferLogSql = `INSERT INTO fundstransfer (UserID, Amount, Transfer_User_ID) VALUES (?, ?, ?)`;

            db.query(transferLogSql, [senderUserName, amount, receiverUserName], (err) => {
              if (err) {
                console.warn("Wallet transfer succeeded but logging failed.");
                return res.status(200).json({ message: "Funds transferred, but not logged" });
              }

              return res.status(200).json({ message: "Funds transferred successfully ✅" });
            });
          });
        });
      });
    });
  });


  app.post("/convert-token", (req, res) => {
    const { userName, convertedAmount } = req.body;

    if (!userName || !convertedAmount) {
      return res.status(400).json({ message: "Missing fields" });
    }

    const tokenAmount = Math.floor(convertedAmount / 10);


    db.query(
      "SELECT SUM(wallet) AS totalWallet FROM member_wallet WHERE userName = ?",
      [userName],
      (err, results) => {
        if (err) {
          console.error("Query error:", err);
          return res.status(500).json({ message: "Database error", error: err });
        }

        const totalWallet = results[0]?.totalWallet || 0;

        if (totalWallet < convertedAmount) {
          return res
            .status(400)
            .json({ message: "Insufficient wallet balance" });
        }


        const insertTokenQuery =
          "INSERT INTO member_tokens (userName, converted_amount, token_amount, conversion_date) VALUES (?, ?, ?, NOW())";

        db.query(
          insertTokenQuery,
          [userName, convertedAmount, tokenAmount],
          (err, result) => {
            if (err) {
              console.error("Token insert error:", err);
              return res
                .status(500)
                .json({ message: "Token insert failed", error: err });
            }


            const deductWalletQuery =
              "INSERT INTO member_wallet (date, wallet, userName) VALUES (NOW(), ?, ?)";

            db.query(
              deductWalletQuery,
              [-convertedAmount, userName],
              (err, result2) => {
                if (err) {
                  console.error("Wallet deduction error:", err);
                  return res
                    .status(500)
                    .json({ message: "Wallet deduction failed", error: err });
                }

                return res.status(200).json({
                  message: `Converted ${convertedAmount} PKR to ${tokenAmount} tokens successfully.`,
                  tokenAmount,
                });
              }
            );
          }
        );
      }
    );
  });

  app.get("/get-user-tokens/:userName", (req, res) => {
    const { userName } = req.params;

    if (!userName) {
      return res.status(400).json({ message: "Missing userName" });
    }

    const sql = "SELECT SUM(token_amount) AS totalTokens FROM member_tokens WHERE userName = ?";
    db.query(sql, [userName], (err, results) => {
      if (err) {
        console.error("Error fetching tokens:", err);
        return res.status(500).json({ message: "Server error", error: err });
      }

      const totalTokens = results[0]?.totalTokens || 0;
      res.status(200).json({ totalTokens });
    });
  });

  app.post('/fundstransferList', (req, res) => {
    db.query(`SELECT * FROM fundstransfer ORDER BY id DESC`, (err, result) => {
      if (err) return res.status(500).json({ error: "Error fetching transfers" });
      res.json(result);
    });
  });


  app.get("/user-details/:id", (req, res) => {
    const { id } = req.params;
    db.query("SELECT * FROM memberregistration WHERE id = ?", [id], (err, result) => {
      if (err) return res.status(500).json({ error: "Database error" });
      if (result.length === 0) return res.status(404).json({ error: "User not found" });
      res.json(result[0]);
    });
  });

  app.put("/user-details/:id", (req, res) => {
    const { id } = req.params;
    const updateData = req.body;

    const fields = Object.keys(updateData).map(field => `${field} = ?`).join(", ");
    const values = [...Object.values(updateData), id];

    const sql = `UPDATE memberregistration SET ${fields} WHERE id = ?`;
    db.query(sql, values, (err) => {
      if (err) return res.status(500).json({ error: "Update failed" });
      res.json({ message: "User updated successfully" });
    });
  });


  app.post('/withdrawal_requests', (req, res) => {
    const { userName, amount, platform } = req.body;
    const sql = `
    INSERT INTO withdrawal_requests (userName, amount, platform, status, created_at)
    VALUES (?, ?, ?, 'pending', NOW())
  `;
    db.query(sql, [userName, amount, platform], (err, result) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ message: 'Withdrawal request submitted successfully', requestId: result.insertId });
    });
  });


  app.get('/withdrawal_requests', (req, res) => {
    db.query('SELECT * FROM withdrawal_requests ORDER BY created_at DESC', (err, results) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(results);
    });
  });


  app.put('/withdrawal_requests/:id/status', (req, res) => {
    const { id } = req.params;
    const { status } = req.body;

    if (!['approved', 'disapproved'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status value' });
    }


    const getRequestSql = 'SELECT * FROM withdrawal_requests WHERE id = ?';
    db.query(getRequestSql, [id], (err, results) => {
      if (err || results.length === 0) {
        return res.status(500).json({ error: 'Withdrawal request not found' });
      }

      const request = results[0];
      const { userName, amount } = request;

      if (status === 'approved') {

        const getWalletSql = 'SELECT SUM(wallet) AS total FROM member_wallet WHERE userName = ?';
        db.query(getWalletSql, [userName], (err, result) => {
          if (err) return res.status(500).json({ error: err.message });

          const currentBalance = result[0].total || 0;

          if (currentBalance < amount) {
            return res.status(400).json({ error: 'Insufficient wallet balance for withdrawal' });
          }


          const insertSql = `
          INSERT INTO member_wallet (date, wallet, userName)
          VALUES (NOW(), ?, ?)
        `;
          db.query(insertSql, [-amount, userName], (err) => {
            if (err) return res.status(500).json({ error: err.message });


            const updateSql = 'UPDATE withdrawal_requests SET status = ? WHERE id = ?';
            db.query(updateSql, [status, id], (err) => {
              if (err) return res.status(500).json({ error: err.message });
              res.json({ message: 'Withdrawal approved and wallet updated' });
            });
          });
        });
      } else {

        const updateSql = 'UPDATE withdrawal_requests SET status = ? WHERE id = ?';
        db.query(updateSql, [status, id], (err) => {
          if (err) return res.status(500).json({ error: err.message });
          res.json({ message: 'Withdrawal disapproved' });
        });
      }
    });
  });


  app.listen(8081, () => {
    console.log("Server is running on port 8081");
  });
