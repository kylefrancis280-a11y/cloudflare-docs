'use strict';

const { getAllAgents } = require('../../agents/registry');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { 
      statusCode: 200, 
      headers: { 
        'Access-Control-Allow-Origin': 'https://shotbreak.io',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'GET, OPTIONS'
      } 
    };
  }

  return {
    statusCode: 200,
    headers: {
      'Access-Control-Allow-Origin': 'https://shotbreak.io',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ agents: getAllAgents() })
  };
};
