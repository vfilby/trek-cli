#!/usr/bin/env node
/**
 * TREK MCP Server
 * JSONRPC stdin/stdout MCP server for the TREK self-hosted travel planner.
 * No npm dependencies — uses Node 22 native fetch.
 */
import readline from 'readline';

const TREK_URL = (process.env.TREK_URL || '').replace(/\/+$/, '');
const TREK_EMAIL = process.env.TREK_EMAIL || '';
const TREK_PASSWORD = process.env.TREK_PASSWORD || '';

let token = null;

function debug(msg) {
  process.stderr.write(`[trek-mcp] ${msg}\n`);
}

// Auth & API client

async function login() {
  if (!TREK_URL || !TREK_EMAIL || !TREK_PASSWORD) {
    throw new Error('Missing TREK_URL, TREK_EMAIL, or TREK_PASSWORD environment variables');
  }

  const res = await fetch(`${TREK_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: TREK_EMAIL, password: TREK_PASSWORD }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Login failed (${res.status}): ${text}`);
  }

  const data = await res.json();
  token = data.token;
  debug(`logged in as ${data.user?.username || TREK_EMAIL}`);
}

async function trekApi(method, path, body, retry = true) {
  if (!token) await login();

  const url = `${TREK_URL}${path}`;
  const options = { method, headers: { Authorization: `Bearer ${token}` } };

  if (body && (method === 'POST' || method === 'PUT' || method === 'PATCH')) {
    options.headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(body);
  }

  const res = await fetch(url, options);

  if (res.status === 401 && retry) {
    token = null;
    await login();
    return trekApi(method, path, body, false);
  }

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`TREK API ${method} ${path} returned ${res.status}: ${text}`);
  }

  const ct = res.headers.get('content-type') || '';
  if (ct.includes('application/json')) return res.json();
  return res.text();
}

function get(path) { return trekApi('GET', path); }
function post(path, body) { return trekApi('POST', path, body); }
function put(path, body) { return trekApi('PUT', path, body); }
function del(path) { return trekApi('DELETE', path); }

// Tool implementations — Trips

async function listTrips({ archived } = {}) {
  const q = archived ? '?archived=1' : '';
  const { trips } = await get(`/api/trips${q}`);
  return { trips, count: trips.length };
}

async function createTrip({ title, description, start_date, end_date, currency }) {
  const body = { title };
  if (description) body.description = description;
  if (start_date) body.start_date = start_date;
  if (end_date) body.end_date = end_date;
  if (currency) body.currency = currency;
  return post('/api/trips', body);
}

async function getTrip({ trip_id }) {
  return get(`/api/trips/${trip_id}`);
}

async function updateTrip({ trip_id, ...fields }) {
  return put(`/api/trips/${trip_id}`, fields);
}

async function deleteTrip({ trip_id }) {
  return del(`/api/trips/${trip_id}`);
}

// Tool implementations — Days

async function listDays({ trip_id }) {
  return get(`/api/trips/${trip_id}/days`);
}

async function addDay({ trip_id, date, notes }) {
  const body = {};
  if (date) body.date = date;
  if (notes) body.notes = notes;
  return post(`/api/trips/${trip_id}/days`, body);
}

async function updateDay({ trip_id, day_id, title, notes }) {
  const body = {};
  if (title !== undefined) body.title = title;
  if (notes !== undefined) body.notes = notes;
  return put(`/api/trips/${trip_id}/days/${day_id}`, body);
}

// Tool implementations — Places

async function listPlaces({ trip_id, search, category, tag }) {
  const params = new URLSearchParams();
  if (search) params.set('search', search);
  if (category) params.set('category', category);
  if (tag) params.set('tag', tag);
  const q = params.toString() ? `?${params}` : '';
  return get(`/api/trips/${trip_id}/places${q}`);
}

async function addPlace({ trip_id, ...fields }) {
  return post(`/api/trips/${trip_id}/places`, fields);
}

async function updatePlace({ trip_id, place_id, ...fields }) {
  return put(`/api/trips/${trip_id}/places/${place_id}`, fields);
}

async function deletePlace({ trip_id, place_id }) {
  return del(`/api/trips/${trip_id}/places/${place_id}`);
}

// Tool implementations — Assignments

async function assignPlaceToDay({ trip_id, day_id, place_id, notes }) {
  const body = { place_id };
  if (notes) body.notes = notes;
  return post(`/api/trips/${trip_id}/days/${day_id}/assignments`, body);
}

async function removeAssignment({ trip_id, day_id, assignment_id }) {
  return del(`/api/trips/${trip_id}/days/${day_id}/assignments/${assignment_id}`);
}

async function reorderDay({ trip_id, day_id, ordered_ids }) {
  return put(`/api/trips/${trip_id}/days/${day_id}/assignments/reorder`, { orderedIds: ordered_ids });
}

async function setAssignmentTime({ trip_id, assignment_id, place_time, end_time }) {
  const body = {};
  if (place_time !== undefined) body.place_time = place_time;
  if (end_time !== undefined) body.end_time = end_time;
  return put(`/api/trips/${trip_id}/assignments/${assignment_id}/time`, body);
}

// Tool implementations — Budget

async function listBudget({ trip_id }) {
  return get(`/api/trips/${trip_id}/budget`);
}

async function addExpense({ trip_id, name, category, total_price, persons, days, note }) {
  const body = { name };
  if (category) body.category = category;
  if (total_price !== undefined) body.total_price = total_price;
  if (persons !== undefined) body.persons = persons;
  if (days !== undefined) body.days = days;
  if (note) body.note = note;
  return post(`/api/trips/${trip_id}/budget`, body);
}

async function updateExpense({ trip_id, expense_id, ...fields }) {
  return put(`/api/trips/${trip_id}/budget/${expense_id}`, fields);
}

async function deleteExpense({ trip_id, expense_id }) {
  return del(`/api/trips/${trip_id}/budget/${expense_id}`);
}

async function budgetSummary({ trip_id }) {
  return get(`/api/trips/${trip_id}/budget/summary/per-person`);
}

// Tool implementations — Reservations

async function listReservations({ trip_id }) {
  return get(`/api/trips/${trip_id}/reservations`);
}

async function addReservation({ trip_id, title, ...fields }) {
  return post(`/api/trips/${trip_id}/reservations`, { title, ...fields });
}

async function updateReservation({ trip_id, reservation_id, ...fields }) {
  return put(`/api/trips/${trip_id}/reservations/${reservation_id}`, fields);
}

async function deleteReservation({ trip_id, reservation_id }) {
  return del(`/api/trips/${trip_id}/reservations/${reservation_id}`);
}

// Tool implementations — Packing

async function listPacking({ trip_id }) {
  return get(`/api/trips/${trip_id}/packing`);
}

async function addPackingItem({ trip_id, name, category }) {
  const body = { name };
  if (category) body.category = category;
  return post(`/api/trips/${trip_id}/packing`, body);
}

async function checkPackingItem({ trip_id, item_id, checked }) {
  return put(`/api/trips/${trip_id}/packing/${item_id}`, { checked: !!checked });
}

async function deletePackingItem({ trip_id, item_id }) {
  return del(`/api/trips/${trip_id}/packing/${item_id}`);
}

// Tool implementations — Maps

async function searchLocation({ query }) {
  return post('/api/maps/search', { query });
}

async function placeDetails({ place_id }) {
  return get(`/api/maps/details/${place_id}`);
}

// Tool implementations — Weather

async function getWeather({ lat, lng, date }) {
  const params = new URLSearchParams({ lat, lng, lang: 'en' });
  if (date) params.set('date', date);
  return get(`/api/weather?${params}`);
}

// Tool implementations — Day Notes

async function listDayNotes({ trip_id, day_id }) {
  return get(`/api/trips/${trip_id}/days/${day_id}/notes`);
}

async function addDayNote({ trip_id, day_id, text, time, icon }) {
  const body = { text };
  if (time) body.time = time;
  if (icon) body.icon = icon;
  return post(`/api/trips/${trip_id}/days/${day_id}/notes`, body);
}

// Tool definitions

const tools = [
  // Trips
  {
    name: 'list_trips',
    description: 'List all trips. Returns trip titles, dates, and summary counts.',
    inputSchema: {
      type: 'object',
      properties: {
        archived: { type: 'boolean', description: 'If true, show archived trips instead of active ones' },
      },
    },
  },
  {
    name: 'create_trip',
    description: 'Create a new trip. Automatically generates day records from the date range (max 90 days).',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Trip title' },
        description: { type: 'string', description: 'Trip description' },
        start_date: { type: 'string', description: 'Start date (YYYY-MM-DD)' },
        end_date: { type: 'string', description: 'End date (YYYY-MM-DD)' },
        currency: { type: 'string', description: 'Currency code (e.g. EUR, USD). Default: EUR' },
      },
      required: ['title'],
    },
  },
  {
    name: 'get_trip',
    description: 'Get full details of a specific trip including day/place/member counts.',
    inputSchema: {
      type: 'object',
      properties: {
        trip_id: { type: 'number', description: 'Trip ID' },
      },
      required: ['trip_id'],
    },
  },
  {
    name: 'update_trip',
    description: 'Update trip properties (title, dates, currency, archive status).',
    inputSchema: {
      type: 'object',
      properties: {
        trip_id: { type: 'number', description: 'Trip ID' },
        title: { type: 'string', description: 'New title' },
        description: { type: 'string', description: 'New description' },
        start_date: { type: 'string', description: 'New start date (YYYY-MM-DD)' },
        end_date: { type: 'string', description: 'New end date (YYYY-MM-DD)' },
        currency: { type: 'string', description: 'New currency code' },
        is_archived: { type: 'boolean', description: 'Archive or unarchive the trip' },
      },
      required: ['trip_id'],
    },
  },
  {
    name: 'delete_trip',
    description: 'Permanently delete a trip and all its associated data. Owner only.',
    inputSchema: {
      type: 'object',
      properties: {
        trip_id: { type: 'number', description: 'Trip ID' },
      },
      required: ['trip_id'],
    },
  },

  // Days
  {
    name: 'list_days',
    description: 'List all days in a trip with their assignments, notes, and titles.',
    inputSchema: {
      type: 'object',
      properties: {
        trip_id: { type: 'number', description: 'Trip ID' },
      },
      required: ['trip_id'],
    },
  },
  {
    name: 'add_day',
    description: 'Add a new day to a trip.',
    inputSchema: {
      type: 'object',
      properties: {
        trip_id: { type: 'number', description: 'Trip ID' },
        date: { type: 'string', description: 'Date (YYYY-MM-DD)' },
        notes: { type: 'string', description: 'Day notes' },
      },
      required: ['trip_id'],
    },
  },
  {
    name: 'update_day',
    description: 'Update a day title or notes.',
    inputSchema: {
      type: 'object',
      properties: {
        trip_id: { type: 'number', description: 'Trip ID' },
        day_id: { type: 'number', description: 'Day ID' },
        title: { type: 'string', description: 'Day title (e.g. "Arrival Day")' },
        notes: { type: 'string', description: 'Day notes' },
      },
      required: ['trip_id', 'day_id'],
    },
  },

  // Places
  {
    name: 'list_places',
    description: 'List all places added to a trip. Supports search, category, and tag filters.',
    inputSchema: {
      type: 'object',
      properties: {
        trip_id: { type: 'number', description: 'Trip ID' },
        search: { type: 'string', description: 'Search by name' },
        category: { type: 'string', description: 'Filter by category' },
        tag: { type: 'string', description: 'Filter by tag' },
      },
      required: ['trip_id'],
    },
  },
  {
    name: 'add_place',
    description: 'Add a place/destination to a trip. Use search_location first to get coordinates.',
    inputSchema: {
      type: 'object',
      properties: {
        trip_id: { type: 'number', description: 'Trip ID' },
        name: { type: 'string', description: 'Place name (max 200 chars)' },
        description: { type: 'string', description: 'Description (max 2000 chars)' },
        lat: { type: 'number', description: 'Latitude' },
        lng: { type: 'number', description: 'Longitude' },
        address: { type: 'string', description: 'Street address (max 500 chars)' },
        category_id: { type: 'number', description: 'Category ID' },
        price: { type: 'number', description: 'Estimated price' },
        currency: { type: 'string', description: 'Price currency code' },
        duration_minutes: { type: 'number', description: 'Expected visit duration in minutes' },
        notes: { type: 'string', description: 'Notes (max 2000 chars)' },
        website: { type: 'string', description: 'Website URL' },
        phone: { type: 'string', description: 'Phone number' },
        transport_mode: { type: 'string', description: 'How to reach: walking, driving, transit, bicycling. Default: walking' },
        tags: { type: 'array', items: { type: 'number' }, description: 'Array of tag IDs to apply' },
      },
      required: ['trip_id', 'name'],
    },
  },
  {
    name: 'update_place',
    description: 'Update a place. All fields optional except trip_id and place_id.',
    inputSchema: {
      type: 'object',
      properties: {
        trip_id: { type: 'number', description: 'Trip ID' },
        place_id: { type: 'number', description: 'Place ID' },
        name: { type: 'string', description: 'Place name' },
        description: { type: 'string', description: 'Description' },
        lat: { type: 'number', description: 'Latitude' },
        lng: { type: 'number', description: 'Longitude' },
        address: { type: 'string', description: 'Address' },
        category_id: { type: 'number', description: 'Category ID' },
        price: { type: 'number', description: 'Price' },
        currency: { type: 'string', description: 'Currency' },
        duration_minutes: { type: 'number', description: 'Duration in minutes' },
        notes: { type: 'string', description: 'Notes' },
        website: { type: 'string', description: 'Website' },
        phone: { type: 'string', description: 'Phone' },
        transport_mode: { type: 'string', description: 'Transport mode' },
        tags: { type: 'array', items: { type: 'number' }, description: 'Tag IDs' },
      },
      required: ['trip_id', 'place_id'],
    },
  },
  {
    name: 'delete_place',
    description: 'Remove a place from a trip.',
    inputSchema: {
      type: 'object',
      properties: {
        trip_id: { type: 'number', description: 'Trip ID' },
        place_id: { type: 'number', description: 'Place ID' },
      },
      required: ['trip_id', 'place_id'],
    },
  },

  // Assignments
  {
    name: 'assign_place_to_day',
    description: 'Assign a place to a specific day in the itinerary. The place must already exist in the trip.',
    inputSchema: {
      type: 'object',
      properties: {
        trip_id: { type: 'number', description: 'Trip ID' },
        day_id: { type: 'number', description: 'Day ID' },
        place_id: { type: 'number', description: 'Place ID' },
        notes: { type: 'string', description: 'Assignment notes' },
      },
      required: ['trip_id', 'day_id', 'place_id'],
    },
  },
  {
    name: 'remove_assignment',
    description: 'Remove a place assignment from a day.',
    inputSchema: {
      type: 'object',
      properties: {
        trip_id: { type: 'number', description: 'Trip ID' },
        day_id: { type: 'number', description: 'Day ID' },
        assignment_id: { type: 'number', description: 'Assignment ID' },
      },
      required: ['trip_id', 'day_id', 'assignment_id'],
    },
  },
  {
    name: 'reorder_day',
    description: 'Reorder place assignments within a day by providing the desired order of assignment IDs.',
    inputSchema: {
      type: 'object',
      properties: {
        trip_id: { type: 'number', description: 'Trip ID' },
        day_id: { type: 'number', description: 'Day ID' },
        ordered_ids: { type: 'array', items: { type: 'number' }, description: 'Assignment IDs in desired order' },
      },
      required: ['trip_id', 'day_id', 'ordered_ids'],
    },
  },
  {
    name: 'set_assignment_time',
    description: 'Set start and/or end time for a place assignment. Pass null to clear a time.',
    inputSchema: {
      type: 'object',
      properties: {
        trip_id: { type: 'number', description: 'Trip ID' },
        assignment_id: { type: 'number', description: 'Assignment ID' },
        place_time: { type: ['string', 'null'], description: 'Start time (e.g. "09:00")' },
        end_time: { type: ['string', 'null'], description: 'End time (e.g. "11:00")' },
      },
      required: ['trip_id', 'assignment_id'],
    },
  },

  // Budget
  {
    name: 'list_budget',
    description: 'List all budget/expense items for a trip with per-member payment status.',
    inputSchema: {
      type: 'object',
      properties: {
        trip_id: { type: 'number', description: 'Trip ID' },
      },
      required: ['trip_id'],
    },
  },
  {
    name: 'add_expense',
    description: 'Add a budget/expense item to a trip.',
    inputSchema: {
      type: 'object',
      properties: {
        trip_id: { type: 'number', description: 'Trip ID' },
        name: { type: 'string', description: 'Expense name (e.g. "Hotel", "Flight")' },
        category: { type: 'string', description: 'Category (e.g. "Accommodation", "Transport", "Food", "Activities", "Other"). Default: "Other"' },
        total_price: { type: 'number', description: 'Total price. Default: 0' },
        persons: { type: 'number', description: 'Number of persons to split between' },
        days: { type: 'number', description: 'Number of days (for per-day expenses)' },
        note: { type: 'string', description: 'Notes about this expense' },
      },
      required: ['trip_id', 'name'],
    },
  },
  {
    name: 'update_expense',
    description: 'Update a budget/expense item.',
    inputSchema: {
      type: 'object',
      properties: {
        trip_id: { type: 'number', description: 'Trip ID' },
        expense_id: { type: 'number', description: 'Budget item ID' },
        name: { type: 'string', description: 'Expense name' },
        category: { type: 'string', description: 'Category' },
        total_price: { type: 'number', description: 'Total price' },
        persons: { type: 'number', description: 'Number of persons' },
        days: { type: 'number', description: 'Number of days' },
        note: { type: 'string', description: 'Notes' },
      },
      required: ['trip_id', 'expense_id'],
    },
  },
  {
    name: 'delete_expense',
    description: 'Delete a budget/expense item.',
    inputSchema: {
      type: 'object',
      properties: {
        trip_id: { type: 'number', description: 'Trip ID' },
        expense_id: { type: 'number', description: 'Budget item ID' },
      },
      required: ['trip_id', 'expense_id'],
    },
  },
  {
    name: 'budget_summary',
    description: 'Get per-person budget summary showing total assigned, total paid, and item counts.',
    inputSchema: {
      type: 'object',
      properties: {
        trip_id: { type: 'number', description: 'Trip ID' },
      },
      required: ['trip_id'],
    },
  },

  // Reservations
  {
    name: 'list_reservations',
    description: 'List all reservations for a trip (flights, hotels, restaurants, etc.).',
    inputSchema: {
      type: 'object',
      properties: {
        trip_id: { type: 'number', description: 'Trip ID' },
      },
      required: ['trip_id'],
    },
  },
  {
    name: 'add_reservation',
    description: 'Add a reservation (flight, hotel, restaurant, activity, transport, or other).',
    inputSchema: {
      type: 'object',
      properties: {
        trip_id: { type: 'number', description: 'Trip ID' },
        title: { type: 'string', description: 'Reservation title (e.g. "Flight LAX-NRT", "Hotel Shinjuku")' },
        type: { type: 'string', description: 'Type: flight, hotel, restaurant, activity, transport, other' },
        reservation_time: { type: 'string', description: 'Start time (ISO datetime)' },
        reservation_end_time: { type: 'string', description: 'End time (ISO datetime)' },
        location: { type: 'string', description: 'Location or address' },
        confirmation_number: { type: 'string', description: 'Booking confirmation number' },
        notes: { type: 'string', description: 'Additional notes' },
        status: { type: 'string', description: 'Status: pending, confirmed, cancelled. Default: pending' },
        day_id: { type: 'number', description: 'Link to a specific day' },
        place_id: { type: 'number', description: 'Link to a specific place' },
      },
      required: ['trip_id', 'title'],
    },
  },
  {
    name: 'update_reservation',
    description: 'Update a reservation.',
    inputSchema: {
      type: 'object',
      properties: {
        trip_id: { type: 'number', description: 'Trip ID' },
        reservation_id: { type: 'number', description: 'Reservation ID' },
        title: { type: 'string', description: 'Title' },
        type: { type: 'string', description: 'Type' },
        reservation_time: { type: 'string', description: 'Start time' },
        reservation_end_time: { type: 'string', description: 'End time' },
        location: { type: 'string', description: 'Location' },
        confirmation_number: { type: 'string', description: 'Confirmation number' },
        notes: { type: 'string', description: 'Notes' },
        status: { type: 'string', description: 'Status' },
        day_id: { type: 'number', description: 'Day ID' },
        place_id: { type: 'number', description: 'Place ID' },
      },
      required: ['trip_id', 'reservation_id'],
    },
  },
  {
    name: 'delete_reservation',
    description: 'Delete a reservation.',
    inputSchema: {
      type: 'object',
      properties: {
        trip_id: { type: 'number', description: 'Trip ID' },
        reservation_id: { type: 'number', description: 'Reservation ID' },
      },
      required: ['trip_id', 'reservation_id'],
    },
  },

  // Packing
  {
    name: 'list_packing',
    description: 'List all packing items for a trip, grouped by category with checked status.',
    inputSchema: {
      type: 'object',
      properties: {
        trip_id: { type: 'number', description: 'Trip ID' },
      },
      required: ['trip_id'],
    },
  },
  {
    name: 'add_packing_item',
    description: 'Add an item to the packing list.',
    inputSchema: {
      type: 'object',
      properties: {
        trip_id: { type: 'number', description: 'Trip ID' },
        name: { type: 'string', description: 'Item name' },
        category: { type: 'string', description: 'Category (e.g. "Clothing", "Electronics", "Toiletries"). Default: "General"' },
      },
      required: ['trip_id', 'name'],
    },
  },
  {
    name: 'check_packing_item',
    description: 'Toggle the checked status of a packing item.',
    inputSchema: {
      type: 'object',
      properties: {
        trip_id: { type: 'number', description: 'Trip ID' },
        item_id: { type: 'number', description: 'Packing item ID' },
        checked: { type: 'boolean', description: 'Whether the item is packed' },
      },
      required: ['trip_id', 'item_id', 'checked'],
    },
  },
  {
    name: 'delete_packing_item',
    description: 'Remove an item from the packing list.',
    inputSchema: {
      type: 'object',
      properties: {
        trip_id: { type: 'number', description: 'Trip ID' },
        item_id: { type: 'number', description: 'Packing item ID' },
      },
      required: ['trip_id', 'item_id'],
    },
  },

  // Maps
  {
    name: 'search_location',
    description: 'Search for places/locations. Uses Google Places API if configured, falls back to OpenStreetMap.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query (e.g. "restaurants near Shibuya Tokyo", "Eiffel Tower")' },
      },
      required: ['query'],
    },
  },
  {
    name: 'place_details',
    description: 'Get detailed info about a place (ratings, hours, reviews, website, phone).',
    inputSchema: {
      type: 'object',
      properties: {
        place_id: { type: 'string', description: 'Google Place ID or OSM ID from search_location results' },
      },
      required: ['place_id'],
    },
  },

  // Weather
  {
    name: 'get_weather',
    description: 'Get weather for a location. Current weather if no date, forecast up to 16 days, or historical averages beyond.',
    inputSchema: {
      type: 'object',
      properties: {
        lat: { type: 'number', description: 'Latitude' },
        lng: { type: 'number', description: 'Longitude' },
        date: { type: 'string', description: 'Date (YYYY-MM-DD). Omit for current weather.' },
      },
      required: ['lat', 'lng'],
    },
  },

  // Day Notes
  {
    name: 'list_day_notes',
    description: 'List all notes for a specific day.',
    inputSchema: {
      type: 'object',
      properties: {
        trip_id: { type: 'number', description: 'Trip ID' },
        day_id: { type: 'number', description: 'Day ID' },
      },
      required: ['trip_id', 'day_id'],
    },
  },
  {
    name: 'add_day_note',
    description: 'Add a note to a specific day.',
    inputSchema: {
      type: 'object',
      properties: {
        trip_id: { type: 'number', description: 'Trip ID' },
        day_id: { type: 'number', description: 'Day ID' },
        text: { type: 'string', description: 'Note text (max 500 chars)' },
        time: { type: 'string', description: 'Time label (e.g. "09:00", "Morning")' },
        icon: { type: 'string', description: 'Emoji icon. Default: pencil emoji' },
      },
      required: ['trip_id', 'day_id', 'text'],
    },
  },
];

// Tool dispatch

async function handleToolCall(name, args) {
  switch (name) {
    case 'list_trips': return listTrips(args);
    case 'create_trip': return createTrip(args);
    case 'get_trip': return getTrip(args);
    case 'update_trip': return updateTrip(args);
    case 'delete_trip': return deleteTrip(args);

    case 'list_days': return listDays(args);
    case 'add_day': return addDay(args);
    case 'update_day': return updateDay(args);

    case 'list_places': return listPlaces(args);
    case 'add_place': return addPlace(args);
    case 'update_place': return updatePlace(args);
    case 'delete_place': return deletePlace(args);

    case 'assign_place_to_day': return assignPlaceToDay(args);
    case 'remove_assignment': return removeAssignment(args);
    case 'reorder_day': return reorderDay(args);
    case 'set_assignment_time': return setAssignmentTime(args);

    case 'list_budget': return listBudget(args);
    case 'add_expense': return addExpense(args);
    case 'update_expense': return updateExpense(args);
    case 'delete_expense': return deleteExpense(args);
    case 'budget_summary': return budgetSummary(args);

    case 'list_reservations': return listReservations(args);
    case 'add_reservation': return addReservation(args);
    case 'update_reservation': return updateReservation(args);
    case 'delete_reservation': return deleteReservation(args);

    case 'list_packing': return listPacking(args);
    case 'add_packing_item': return addPackingItem(args);
    case 'check_packing_item': return checkPackingItem(args);
    case 'delete_packing_item': return deletePackingItem(args);

    case 'search_location': return searchLocation(args);
    case 'place_details': return placeDetails(args);

    case 'get_weather': return getWeather(args);

    case 'list_day_notes': return listDayNotes(args);
    case 'add_day_note': return addDayNote(args);

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

// MCP JSONRPC Protocol

async function handleRequest(request) {
  try {
    if (request.method === 'initialize') {
      return {
        jsonrpc: '2.0',
        id: request.id,
        result: {
          protocolVersion: '2024-11-05',
          serverInfo: {
            name: 'trek-mcp',
            version: '1.0.0',
          },
          capabilities: {
            tools: {},
          },
        },
      };
    }

    if (request.method === 'tools/list') {
      return {
        jsonrpc: '2.0',
        id: request.id,
        result: { tools },
      };
    }

    if (request.method === 'tools/call') {
      const { name, arguments: args } = request.params;
      const result = await handleToolCall(name, args);

      return {
        jsonrpc: '2.0',
        id: request.id,
        result: {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        },
      };
    }

    // notifications (no response needed)
    if (!request.id) return null;

    return {
      jsonrpc: '2.0',
      id: request.id,
      error: {
        code: -32601,
        message: 'Method not found',
      },
    };
  } catch (error) {
    return {
      jsonrpc: '2.0',
      id: request.id,
      error: {
        code: -32603,
        message: error.message,
      },
    };
  }
}

// Main loop

async function main() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: false,
  });

  for await (const line of rl) {
    if (!line.trim()) continue;
    const request = JSON.parse(line);
    const response = await handleRequest(request);
    if (response) console.log(JSON.stringify(response));
  }
}

main().catch(console.error);
