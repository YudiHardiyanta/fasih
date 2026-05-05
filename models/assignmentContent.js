const { DataTypes } = require("sequelize");
const sequelize = require("../database");

const AssignmentContent = sequelize.define("AssignmentContent", {

  id: {
    type: DataTypes.STRING,
    primaryKey: true
  },

  pre_defined_data: {
    type: DataTypes.JSON,
    allowNull: true,
  },

  answer: {
    type: DataTypes.JSON,
    allowNull: true,
  },

}, {
  tableName: "assignment_content",
  timestamps: false
});

module.exports = AssignmentContent;