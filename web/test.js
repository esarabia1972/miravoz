const math = require('mathjs');

let X = [[1, 2, 3], [1, 3, 4], [1, 4, 5], [1, 5, 6]];
let Y = [100, 200, 300, 400];

const mX = math.matrix(X);
const mY = math.matrix(Y);

const XT = math.transpose(mX);
const XTX = math.multiply(XT, mX);
const I = math.identity(3);
const XTX_plus_lambdaI = math.add(XTX, math.multiply(0, I));
const XTX_inv = math.inv(XTX_plus_lambdaI);
const XTX_inv_XT = math.multiply(XTX_inv, XT);
const Wx = math.multiply(XTX_inv_XT, mY);
console.log(Wx.toArray());
