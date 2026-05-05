const { DataTypes } = require("sequelize");
const sequelize = require("../database");

const ppl = sequelize.define("ppl", {

  id: {
    type: DataTypes.UUID,
    primaryKey: true
  },

  userId: {
    type: DataTypes.UUID
  },

  surveyRoleId: {
    type: DataTypes.UUID
  },

  surveyPeriodId: {
    type: DataTypes.UUID
  },

  regionId: {
    type: DataTypes.JSON
  },

  createdAt: {
    type: DataTypes.DATE
  },

  updatedAt: {
    type: DataTypes.DATE
  },

  username: {
    type: DataTypes.STRING
  },

  fullname: {
    type: DataTypes.STRING
  },

  sequence: {
    type: DataTypes.INTEGER
  },

  description: {
    type: DataTypes.STRING
  },

  surveyRoleGroupId: {
    type: DataTypes.UUID
  },

  smallestAreaOrder: {
    type: DataTypes.INTEGER
  },

  isPencacah: {
    type: DataTypes.BOOLEAN
  }


}, {
  tableName: "ppl_ngibar",
  timestamps: false
});

module.exports = ppl;