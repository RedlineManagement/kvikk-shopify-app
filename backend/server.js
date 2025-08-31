// backend/server.js - Teljes Kvikk-Shopify Public App

const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const { Shopify } = require('@shopify/shopify-api');
const { shopifyApp } = require('@shopify/shopify-app-express');
const { restResources } = require('@shopify/shopify-api/rest/admin/2023-10');

const app = express();

// Shopify App konfiguráció
const shopify = shopifyApp({
  api: {
    apiKey: process.env.SHOPIFY_API_KEY,
    apiSecretKey: process.env.SHOPIFY_API_SECRET,
    scopes: [
      'read_orders',
      'write_orders',
      'read_products', 
      'write_shipping',
      'read_locations',
      'write_fulfillments'
    ],
    hostName: process.env.HOST,
    restResources,
  },
  auth: {
    path: '/api/auth',
    callbackPath: '/api/auth/callback',
  },
  webhooks: {
    path: '/api/webhooks',
  },
  sessionStorage: new Shopify.Session.MemorySessionStorage(),
});

app.use(cors());
app.use(express.json());
app.use(shopify.config.auth.path, shopify.auth.begin());
app.use(shopify.config.auth.callbackPath, shopify.auth.callback());
app.use(shopify.config.webhooks.path, shopify.processWebhooks({
  webhookHandlers: {
    'ORDERS_CREATE': ordersCreateHandler,
    'ORDERS_UPDATED': ordersUpdatedHandler,
    'ORDERS_FULFILLED': ordersFulfilledHandler,
  }
}));

// 1. APP TELEPÍTÉS ÉS INICIALIZÁLÁS
app.get('/api/install', shopify.auth.begin());

app.post('/api/app/install', shopify.validateAuthenticatedSession(), async (req, res) => {
  try {
    const session = res.locals.shopify.session;
    
    // Kvikk Carrier Service létrehozása
    await createKvikkCarrierService(session);
    
    // Alapértelmezett beállítások mentése
    await initializeAppSettings(session);
    
    res.status(200).json({ 
      success: true, 
      message: 'Kvikk integráció sikeresen telepítve!' 
    });
  } catch (error) {
    console.error('Telepítési hiba:', error);
    res.status(500).json({ error: 'Telepítési hiba történt' });
  }
});

// 2. KVIKK CARRIER SERVICE LÉTREHOZÁSA
async function createKvikkCarrierService(session) {
  const client = new Shopify.Clients.Rest({ session });
  
  const carrierService = new restResources.CarrierService({ session });
  carrierService.name = 'Kvikk Shipping';
  carrierService.callback_url = `${process.env.HOST}/api/shipping-rates`;
  carrierService.service_discovery = true;
  carrierService.carrier_service_type = 'api';
  carrierService.format = 'json';
  
  await carrierService.save({ update: true });
  
  console.log('Kvikk Carrier Service létrehozva');
}

// 3. SZÁLLÍTÁSI DÍJAK ENDPOINT
app.post('/api/shipping-rates', async (req, res) => {
  try {
    const rateData = req.body.rate;
    console.log('Szállítási díj kérés:', JSON.stringify(rateData, null, 2));
    
    // Kvikk API hívás
    const kvikkRates = await getKvikkShippingRates({
      origin: rateData.origin,
      destination: rateData.destination,
      items: rateData.items,
      currency: rateData.currency
    });
    
    // Shopify formátumra alakítás
    const rates = kvikkRates.map(rate => ({
      service_name: rate.service_name,
      service_code: rate.service_code,
      total_price: Math.round(rate.price * 100), // fillérre
      currency: rate.currency || 'HUF',
      min_delivery_date: rate.min_delivery_date,
      max_delivery_date: rate.max_delivery_date,
      phone_required: rate.phone_required || false,
      description: rate.description || ''
    }));
    
    console.log('Visszaküldött díjak:', rates);
    res.json({ rates });
    
  } catch (error) {
    console.error('Szállítási díj hiba:', error);
    res.json({ 
      rates: [],
      errors: [{ message: 'Szállítási díjak lekérése sikertelen' }]
    });
  }
});

// 4. KVIKK API FUNKCIÓK
async function getKvikkShippingRates(rateRequest) {
  const requestData = {
    origin: {
      postal_code: rateRequest.origin.postal_code || '1011',
      country_code: rateRequest.origin.country || 'HU',
      city: rateRequest.origin.city
    },
    destination: {
      postal_code: rateRequest.destination.postal_code,
      country_code: rateRequest.destination.country,
      city: rateRequest.destination.city
    },
    packages: [{
      weight: calculateTotalWeight(rateRequest.items),
      dimensions: calculatePackageDimensions(rateRequest.items),
      value: calculateTotalValue(rateRequest.items),
      contents: rateRequest.items.map(item => item.name || item.title).join(', ')
    }],
    service_types: ['standard', 'express', 'economy']
  };

  const response = await fetch('https://api.kvikk.hu/v1/rates', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-KEY': process.env.KVIKK_API_KEY
    },
    body: JSON.stringify(requestData)
  });

  if (!response.ok) {
    console.error('Kvikk rates API hiba:', await response.text());
    return getDefaultRates(); // Fallback díjak
  }

  const data = await response.json();
  return data.rates || [];
}

// 5. WEBHOOK KEZELŐK
async function ordersCreateHandler(topic, shop, body, webhookId) {
  try {
    const order = JSON.parse(body);
    console.log(`Új rendelés: ${order.order_number} - ${shop}`);
    
    // Ha van Kvikk szállítási mód kiválasztva
    const shippingLine = order.shipping_lines?.find(line => 
      line.source === 'Kvikk Shipping'
    );
    
    if (shippingLine) {
      // Automatikus szállítmány létrehozás
      await createKvikkShipmentForOrder(order, shop);
    }
    
  } catch (error) {
    console.error('Orders create webhook hiba:', error);
  }
}

async function ordersUpdatedHandler(topic, shop, body, webhookId) {
  // Rendelés frissítés kezelése
  console.log(`Rendelés frissítve: ${shop}`);
}

async function ordersFulfilledHandler(topic, shop, body, webhookId) {
  // Teljesítés kezelése - nyomkövetési szám hozzáadása
  console.log(`Rendelés teljesítve: ${shop}`);
}

// 6. KVIKK SZÁLLÍTMÁNY LÉTREHOZÁS
async function createKvikkShipmentForOrder(order, shop) {
  try {
    const shipmentData = {
      reference: order.order_number,
      recipient: {
        name: `${order.shipping_address.first_name} ${order.shipping_address.last_name}`,
        company: order.shipping_address.company || '',
        address_line_1: order.shipping_address.address1,
        address_line_2: order.shipping_address.address2 || '',
        city: order.shipping_address.city,
        postal_code: order.shipping_address.zip,
        country_code: order.shipping_address.country_code,
        phone: order.shipping_address.phone || order.phone,
        email: order.email
      },
      sender: await getSenderInfo(shop),
      packages: [{
        weight: calculateTotalWeight(order.line_items),
        dimensions: calculatePackageDimensions(order.line_items),
        value: parseFloat(order.subtotal_price),
        currency: order.currency,
        contents: order.line_items.map(item => 
          `${item.title} x${item.quantity}`
        ).join(', ')
      }],
      service_type: getKvikkServiceFromShippingLine(order.shipping_lines[0]),
      insurance: parseFloat(order.subtotal_price) > 50000, // 500€ felett biztosítás
      signature_required: parseFloat(order.subtotal_price) > 100000 // 1000€ felett aláírás
    };

    const response = await fetch('https://api.kvikk.hu/v1/shipments', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-KEY': process.env.KVIKK_API_KEY
      },
      body: JSON.stringify(shipmentData)
    });

    if (!response.ok) {
      throw new Error(`Kvikk API hiba: ${response.statusText}`);
    }

    const shipment = await response.json();
    
    // Shopify rendelés frissítése nyomkövetési számmal
    await updateShopifyOrderWithTracking(order.id, shipment, shop);
    
    console.log(`Kvikk szállítmány létrehozva: ${shipment.tracking_number}`);
    
  } catch (error) {
    console.error('Szállítmány létrehozási hiba:', error);
  }
}

// 7. APP BEÁLLÍTÁSOK KEZELÉSE
app.get('/api/settings', shopify.validateAuthenticatedSession(), async (req, res) => {
  try {
    const session = res.locals.shopify.session;
    const settings = await getAppSettings(session);
    res.json(settings);
  } catch (error) {
    res.status(500).json({ error: 'Beállítások lekérése sikertelen' });
  }
});

app.post('/api/settings', shopify.validateAuthenticatedSession(), async (req, res) => {
  try {
    const session = res.locals.shopify.session;
    await saveAppSettings(session, req.body);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Beállítások mentése sikertelen' });
  }
});

// 8. SEGÉDFÜGGVÉNYEK
function calculateTotalWeight(items) {
  return items.reduce((total, item) => {
    const weight = item.grams || item.weight || 100; // alapértelmezett 100g
    return total + (weight * item.quantity);
  }, 0);
}

function calculatePackageDimensions(items) {
  // Egyszerű logika - később bővíthető
  const totalVolume = items.reduce((volume, item) => {
    return volume + (item.quantity * 1000); // 1000 cm³/termék
  }, 0);
  
  const side = Math.ceil(Math.pow(totalVolume, 1/3));
  
  return {
    length: Math.max(side, 15),
    width: Math.max(side * 0.8, 10),
    height: Math.max(side * 0.6, 5)
  };
}

function calculateTotalValue(items) {
  return items.reduce((total, item) => {
    const price = parseFloat(item.price || item.unit_price || 0);
    return total + (price * item.quantity);
  }, 0);
}

function getDefaultRates() {
  // Fallback díjak, ha Kvikk API nem elérhető
  return [
    {
      service_name: 'Kvikk Standard',
      service_code: 'kvikk_standard',
      price: 1500,
      currency: 'HUF',
      min_delivery_date: new Date(Date.now() + 2*24*60*60*1000).toISOString(),
      max_delivery_date: new Date(Date.now() + 5*24*60*60*1000).toISOString()
    }
  ];
}

async function getSenderInfo(shop) {
  // Bolt adatainak lekérése vagy alapértelmezett
  return {
    name: 'Webshop',
    address_line_1: 'Fő utca 1.',
    city: 'Budapest',
    postal_code: '1011',
    country_code: 'HU',
    phone: '+36301234567'
  };
}

function getKvikkServiceFromShippingLine(shippingLine) {
  const serviceCode = shippingLine.code || shippingLine.service_code || 'standard';
  
  if (serviceCode.includes('express')) return 'express';
  if (serviceCode.includes('economy')) return 'economy';
  return 'standard';
}

async function updateShopifyOrderWithTracking(orderId, shipment, shop) {
  // Shopify Admin API hívás a nyomkövetési szám hozzáadásához
  // Implementálni kell session alapon
}

async function getAppSettings(session) {
  // Metafield-ből vagy adatbázisból
  return {
    kvikk_api_key: process.env.KVIKK_API_KEY ? '***' : '',
    default_service: 'standard',
    auto_create_shipments: true,
    sender_info: {}
  };
}

async function saveAppSettings(session, settings) {
  // Metafield-be vagy adatbázisba mentés
  console.log('Beállítások mentve:', settings);
}

async function initializeAppSettings(session) {
  // Alapértelmezett beállítások létrehozása telepítéskor
  console.log('App inicializálva:', session.shop);
}

// Szerver indítás
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Kvikk-Shopify App fut a ${PORT} porton`);
  console.log(`App URL: ${process.env.HOST}`);
});