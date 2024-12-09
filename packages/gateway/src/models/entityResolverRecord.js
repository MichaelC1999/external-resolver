const mongoose = require('mongoose')

// Define the schema for the LEI entity
const leiSchema = new mongoose.Schema(
  {
    LEI: { type: String, required: true, unique: true }, // Legal Entity Identifier
    name: { type: String },
    owner: { type: String }, // The EVM address of the owner of the domain. In most production cases, this will be the CA of the entity
    nodeHash: { type: String },
    LEIHash: { type: String, required: true, unique: true },
    'partner__[0]__name': { type: String },
    'partner__[0]__LEI': { type: String, ref: 'EntityResolverRecord' },
    'partner__[0]__type': { type: String },
    'partner__[0]__wallet__address': { type: String },
    'partner__[0]__physical__address': { type: String },
    'partner__[0]__DOB': { type: String },
    'partner__[0]__is__manager': { type: String },
    'partner__[0]__is__signer': { type: String },
    'partner__[0]__lockup': { type: String },
    'partner__[0]__shares': { type: String },
    'partner__[1]__name': { type: String },
    'partner__[1]__LEI': { type: String, ref: 'EntityResolverRecord' },
    'partner__[1]__type': { type: String },
    'partner__[1]__wallet__address': { type: String },
    'partner__[1]__physical__address': { type: String },
    'partner__[1]__DOB': { type: String },
    'partner__[1]__is__manager': { type: String },
    'partner__[1]__is__signer': { type: String },
    'partner__[1]__lockup': { type: String },
    'partner__[1]__shares': { type: String },
    'partner__[2]__name': { type: String },
    'partner__[2]__LEI': { type: String, ref: 'EntityResolverRecord' },
    'partner__[2]__type': { type: String },
    'partner__[2]__wallet__address': { type: String },
    'partner__[2]__physical__address': { type: String },
    'partner__[2]__DOB': { type: String },
    'partner__[2]__is__manager': { type: String },
    'partner__[2]__is__signer': { type: String },
    'partner__[2]__lockup': { type: String },
    'partner__[2]__shares': { type: String },
    'partner__[3]__name': { type: String },
    'partner__[3]__LEI': { type: String, ref: 'EntityResolverRecord' },
    'partner__[3]__type': { type: String },
    'partner__[3]__wallet__address': { type: String },
    'partner__[3]__physical__address': { type: String },
    'partner__[3]__DOB': { type: String },
    'partner__[3]__is__manager': { type: String },
    'partner__[3]__is__signer': { type: String },
    'partner__[3]__lockup': { type: String },
    'partner__[3]__shares': { type: String },
    'partner__[4]__name': { type: String },
    'partner__[4]__LEI': { type: String, ref: 'EntityResolverRecord' },
    'partner__[4]__type': { type: String },
    'partner__[4]__wallet__address': { type: String },
    'partner__[4]__physical__address': { type: String },
    'partner__[4]__DOB': { type: String },
    'partner__[4]__is__manager': { type: String },
    'partner__[4]__is__signer': { type: String },
    'partner__[4]__lockup': { type: String },
    'partner__[4]__shares': { type: String },
    'partner__[5]__name': { type: String },
    'partner__[5]__LEI': { type: String, ref: 'EntityResolverRecord' },
    'partner__[5]__type': { type: String },
    'partner__[5]__wallet__address': { type: String },
    'partner__[5]__physical__address': { type: String },
    'partner__[5]__DOB': { type: String },
    'partner__[5]__is__manager': { type: String },
    'partner__[5]__is__signer': { type: String },
    'partner__[5]__lockup': { type: String },
    'partner__[5]__shares': { type: String },
    company__name: { type: String, required: true },
    company__address: { type: String, required: true },
    company__other__name: { type: String },
    company__registrar: { type: String },
    company__type: { type: String },
    company__description: { type: String },
    company__purpose: { type: String },
    company__formation__date: { type: Date },
    company__lockup__days: { type: String },
    company__additional__terms: { type: String },
    company__selected__model: { type: String },
    company__lookup__number: { type: String }, // Optional field for additional lookup
    company__entity__code: {
      type: String,
      validate: {
        validator: function (value) {
          return value.length === 4 // Validate that ELF is exactly 4 characters
        },
        message: 'ELF must be 4 characters long',
      },
      required: true,
    },
    company__status__GLEIF: {
      type: String,
      enum: ['ACTIVE', 'INACTIVE', 'NULL'],
    }, // Status from GLEIF, can be limited to values
    constitutionHash: { type: String },
    creationDate: { type: Date, required: true, default: Date.now }, // Automatically set to now if not provided
  },
  { strict: false },
)

// Create the model from the schema
// const EntityResolverRecord = mongoose.model('EntityResolverRecord', leiSchema);

// module.exports = EntityResolverRecord;
module.exports = leiSchema
