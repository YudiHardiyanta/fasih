const { DataTypes } = require("sequelize");
const sequelize = require("../database");

const Last = sequelize.define("Last", {

  id: {
    type: DataTypes.STRING,
    primaryKey: true
  },

  dateModified: DataTypes.DATE,

}, {
  tableName: "last_data_ngibar",
  timestamps: false
});

module.exports = Last;