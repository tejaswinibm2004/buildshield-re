// Planted bug #6: string concat instead of numeric add (money bug -> must trigger approval).
function cartTotal(a, b) { return a + b; }
function addToCart(a, b) { document.getElementById('total').textContent = 'Total: ' + cartTotal(String(a), String(b)); }
if (typeof module !== 'undefined') module.exports = { cartTotal };
