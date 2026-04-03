# Meowly Frontend

## File Structure
```
Meowly/
├── html/
│   └── index.html         ← Open this in a browser
├── scripts/
│   └── app.js             ← All JS logic + API calls
└── styles/
    └── main.css           ← All styling
```

## How to Run
Open `html/index.html` directly in a browser.
Or serve with a local server (e.g., VS Code Live Server).

---

## ASP.NET Web API Endpoints Expected

Update `API_BASE` in `scripts/app.js` to your deployed URL.

### Auth – Employee
| Method | Endpoint                    | Body                                                                 |
|--------|-----------------------------|----------------------------------------------------------------------|
| POST   | /api/auth/employee/register | firstName, lastName, dob, gender, email, password, employeeId        |
| POST   | /api/auth/employee/login    | employeeId, password                                                 |

**Register response:** `{ employeeId, firstName, lastName, ... }`
> The API should also **send an email** to the employee with their generated ID.

Employee ID format: `1000xxxx` (8 digits, starts with 1000).  
The frontend generates this automatically, but the backend can override it in the response.

### Auth – Customer
| Method | Endpoint                    | Body                                                 |
|--------|-----------------------------|------------------------------------------------------|
| POST   | /api/auth/customer/register | firstName, lastName, dob, gender, email, password    |
| POST   | /api/auth/customer/login    | email, password                                      |

**Login response (both):** `{ id, firstName, lastName, dob, email, ... }`

---

### Bookings
| Method | Endpoint        | Body                                                                                             |
|--------|-----------------|--------------------------------------------------------------------------------------------------|
| POST   | /api/bookings   | ownerName, petName, petType, contactNumber, dateTime, service, paymentMethod, bookingType, customerId |

**Response:** `{ bookingId, status, ... }`

`bookingType` will be `"grooming"` or `"clinic"`.

---

## CORS
Make sure your ASP.NET API has CORS enabled for your frontend origin.

```csharp
builder.Services.AddCors(options => {
    options.AddDefaultPolicy(policy => {
        policy.WithOrigins("http://localhost:3000", "http://127.0.0.1:5500")
              .AllowAnyHeader()
              .AllowAnyMethod();
    });
});
```

## Demo Mode
If the API is not running, the app works in **demo mode** — all pages are accessible, API calls fail gracefully, and the UI continues normally with toast notifications.
