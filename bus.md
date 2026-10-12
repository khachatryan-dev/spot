# Restaurant Digital Platform
## Product, Architecture, Engineering & Implementation Specification

---

## 1. PROJECT OVERVIEW

Build a modern, production-ready restaurant digital platform that connects restaurants and customers through one unified digital experience.

The platform is NOT only a QR menu.

The long-term product vision is:

> Discover → Reserve → Arrive → Scan QR → Browse Menu → Order → Track → Pay → Review → Return

The platform should serve two major sides:

1. Customers
2. Restaurants

There is also a third internal side:

3. Platform Administration

The first 12 months are intentionally FREE.

The platform must not charge restaurants or customers subscription fees, platform commissions, setup fees, or other platform usage fees during the first year.

The first year is a product validation and growth period.

The primary goal of Year 1 is:

Product → Restaurants → Customers → Usage → Feedback → Trust

Do NOT optimize the architecture around monetization during the MVP.

However, the architecture must allow monetization to be added later without rewriting the core platform.

---

# 2. PRODUCT VISION

The platform should become a digital operating layer between restaurants and their customers.

The customer should be able to:

- Discover restaurants
- View restaurant information
- View menus
- Reserve tables
- Pay deposits when supported
- Arrive at the restaurant
- Scan a table QR code
- Join a table session
- Browse the menu
- Customize items
- Place orders
- Track order status
- Call/request waiter assistance
- Request the bill
- Pay
- Split the bill
- Leave a review
- View reservation/order history
- Favorite restaurants
- Eventually receive personalized offers and loyalty benefits

The restaurant should be able to:

- Create and manage its restaurant profile
- Manage multiple locations
- Manage tables
- Generate QR codes
- Build and manage menus
- Receive orders
- Manage kitchen workflow
- Manage reservations
- Manage customers
- Manage payments
- Manage reviews
- Manage staff
- View analytics
- Eventually integrate with POS/1C systems

The platform administrator should be able to:

- Approve restaurants
- Manage users
- Moderate restaurants
- Moderate reviews
- Monitor payments
- Monitor platform activity
- Manage platform configuration
- View analytics
- Review audit logs

---

# 3. CORE PRINCIPLE

The platform must be designed around the restaurant's real operational workflow.

Do not build isolated features.

Every feature should connect to the overall journey.

Example:

QR should not simply open a menu.

QR should resolve:

QR
→ Restaurant
→ Location
→ Table
→ Table Session
→ Customer
→ Menu
→ Cart
→ Order
→ Bill
→ Payment

---

# 4. YEAR 1 BUSINESS STRATEGY

## 4.1 First 12 Months

The platform is free.

No:

- Restaurant subscription
- Customer subscription
- Platform commission
- Setup fee
- QR generation fee
- Menu fee
- Reservation fee
- Ordering fee

The purpose is to remove adoption friction.

## 4.2 Year 1 Objectives

Focus on:

- Real restaurants
- Real customers
- Real orders
- Real reservations
- Real feedback
- Product reliability
- Restaurant retention
- Customer retention

Do NOT measure success only by registered accounts.

Important metrics:

- Active restaurants
- Active locations
- Active tables
- QR scans
- Orders
- Completed orders
- Reservations
- Completed reservations
- Returning customers
- Monthly active customers
- Restaurant retention
- Order success rate

Define an active restaurant as a restaurant that has meaningful activity within a recent period, such as:

- QR scan
- Order
- Reservation
- Menu update
- Customer interaction

---

# 5. TECHNOLOGY STACK

Use a modern TypeScript-first stack.

## Frontend

- Next.js 16+
- React 19+
- TypeScript
- Tailwind CSS v4
- shadcn/ui
- Lucide React

## Client State

- Zustand for local/client state
- TanStack Query for server state where appropriate

Do not duplicate server state unnecessarily in Zustand.

## Forms

- React Hook Form
- Zod

All important forms must have schema validation.

## Backend

Use Next.js App Router initially.

Use:

- Route Handlers
- Server Actions where appropriate
- Server Components
- Server-side services

Do NOT start with microservices.

Use a modular monolith architecture.

If the platform becomes large enough later, individual modules can be extracted.

## Database

- PostgreSQL
- Drizzle ORM

PostgreSQL is the primary source of truth.

## Cache / Realtime Infrastructure

- Redis
- WebSocket / Socket.IO
- Redis Pub/Sub where necessary

## Authentication

Use Auth.js or an equivalent production-ready authentication system.

Support:

- Email/password
- Google OAuth
- Apple OAuth when needed
- Guest sessions for QR ordering

Do not force a customer to create an account before viewing a menu.

## File Storage

Use an S3-compatible storage provider.

Preferred options:

- Cloudflare R2
- Amazon S3

Restaurant images and menu images must not be stored directly in PostgreSQL.

## Maps

Use Mapbox for:

- Restaurant locations
- Maps
- Location search
- Nearby restaurants

Keep the maps provider abstract enough to replace later.

## Payments

Create a provider abstraction.

Do not hardcode one payment provider into the business logic.

Example interface:

```ts
interface PaymentProvider {
  createPayment(input: CreatePaymentInput): Promise<PaymentResult>;
  verifyPayment(input: VerifyPaymentInput): Promise<PaymentVerification>;
  refundPayment(input: RefundPaymentInput): Promise<RefundResult>;
  handleWebhook(request: Request): Promise<WebhookResult>;
}
```

The actual provider can be implemented later.

## Monitoring

Use:

-   Sentry
-   PostHog

## Testing

Use:

-   Vitest
-   Playwright
-   Testing Library where useful

----------

# 6. ARCHITECTURE

Use a modular monolith.

Recommended conceptual architecture:

```
                    WEB APPLICATION
                         |
              -------------------------
              |                       |
        Customer App           Restaurant App
              |                       |
              -----------+-------------
                         |
                    Application Layer
                         |
              -------------------------
              |           |           |
           Services    Policies    Validation
              |
              -------------------------
              |           |           |
           PostgreSQL    Redis      Storage
              |
       -----------------------
       |          |          |
      POS        1C      Payments
```

Do not put business logic directly inside React components.

Do not put business logic directly inside API route handlers.

Use domain/application services.

----------

# 7. RECOMMENDED PROJECT STRUCTURE

Use a scalable feature-oriented structure.

```
src/
├── app/
│   ├── (marketing)/
│   ├── (customer)/
│   ├── (restaurant)/
│   ├── (admin)/
│   ├── t/
│   └── api/
│
├── components/
│   ├── ui/
│   └── shared/
│
├── entities/
│   ├── restaurant/
│   ├── location/
│   ├── table/
│   ├── menu/
│   ├── order/
│   ├── reservation/
│   ├── payment/
│   ├── customer/
│   └── review/
│
├── features/
│   ├── authentication/
│   ├── restaurant-discovery/
│   ├── reservation/
│   ├── qr-session/
│   ├── ordering/
│   ├── checkout/
│   ├── split-bill/
│   └── reviews/
│
├── server/
│   ├── auth/
│   ├── db/
│   ├── services/
│   ├── repositories/
│   ├── policies/
│   ├── events/
│   └── integrations/
│
├── shared/
│   ├── constants/
│   ├── schemas/
│   ├── types/
│   ├── utils/
│   └── config/
│
└── integrations/
    ├── payments/
    ├── pos/
    ├── one-c/
    ├── maps/
    └── notifications/
```

The exact structure may be adapted after inspecting the existing repository.

Do not blindly create every directory before it is needed.

----------

# 8. MULTI-TENANCY

The platform is multi-tenant.

Hierarchy:

```
Platform
  |
  └── Restaurant
       |
       ├── Location
       │    ├── Tables
       │    ├── Menu
       │    ├── Orders
       │    └── Reservations
       |
       └── Staff
```

A restaurant can have multiple locations.

Every restaurant-owned resource must be scoped correctly.

Never allow one restaurant to access another restaurant's data.

Tenant isolation must be enforced server-side.

Never rely only on UI hiding.

----------

# 9. USER ROLES

## Customer

Can:

-   Discover restaurants
-   View restaurants
-   View menus
-   Make reservations
-   Join QR sessions
-   Place orders
-   Track orders
-   Pay
-   Review completed experiences

## Restaurant Owner

Can:

-   Manage restaurant
-   Manage locations
-   Manage menus
-   Manage tables
-   Manage reservations
-   Manage orders
-   Manage staff
-   View analytics

## Restaurant Manager

Operational management permissions.

## Waiter

Can:

-   View table sessions
-   View orders
-   Update service-related statuses
-   Respond to customer requests
-   Request/confirm bills

## Kitchen

Can:

-   View incoming orders
-   Accept orders
-   Update preparation status
-   Mark orders ready

## Cashier

Can:

-   Manage bills
-   Confirm payments
-   Handle payment-related operations

## Platform Admin

Can:

-   Manage restaurants
-   Manage users
-   Moderate content
-   View platform analytics
-   Manage system settings
-   Access audit logs

Use RBAC.

Never trust a role sent from the client.

----------

# 10. RESTAURANT LIFECYCLE

Restaurant states:

```
DRAFT
  ↓
PENDING_REVIEW
  ↓
ACTIVE
  ↓
SUSPENDED
  ↓
CLOSED
```

Only ACTIVE restaurants should appear publicly.

Restaurant approval is controlled by the platform.

----------

# 11. LOCATION MODEL

Restaurants can have multiple locations.

Example:

```
Restaurant: Example Coffee

Location 1:
  Downtown

Location 2:
  Arabkir

Location 3:
  Cascade
```

Each location has:

-   Address
-   Coordinates
-   Phone
-   Opening hours
-   Tables
-   Menu configuration
-   Staff
-   Reservation availability

----------

# 12. TABLE MANAGEMENT

Table fields should conceptually include:

-   id
-   locationId
-   number
-   name
-   capacity
-   zone
-   type
-   status
-   active

Table statuses:

```
AVAILABLE
RESERVED
OCCUPIED
BLOCKED
OUT_OF_SERVICE
```

The table number may be visible to customers.

The internal table ID must never be used as the security mechanism for QR access.

----------

# 13. QR CODE SYSTEM

QR codes are critical.

A QR must resolve to a secure, non-predictable token.

Example:

```
https://platform.com/t/{secure-token}
```

Do NOT use:

```
/t/1
/t/table-12
/t/location-1-table-12
```

Use cryptographically secure random tokens.

QR tokens must support:

-   Creation
-   Activation
-   Revocation
-   Rotation
-   Expiration if needed
-   Audit history

QR resolution:

```
QR Token
   ↓
Resolve Token
   ↓
Restaurant
   ↓
Location
   ↓
Table
   ↓
Create or Join Table Session
```

A revoked QR token must never create a valid session.

----------

# 14. TABLE SESSIONS

A table session represents a real visit.

Example:

```
Table 12
Session #ABC123

Member A
  → Pizza

Member B
  → Burger

Member C
  → Salad
```

Multiple customers can join the same table session.

Each customer can have their own identity/session.

The restaurant sees the unified table session.

----------

# 15. MENU SYSTEM

Menu hierarchy:

```
Menu
 ├── Category
 │    ├── Item
 │    │    ├── Modifier Group
 │    │    │    └── Modifier
```

Menu item fields:

-   Name
-   Description
-   Image
-   Price
-   Currency
-   Category
-   Ingredients
-   Allergens
-   Availability
-   Preparation time
-   Sort order
-   Active status

Support:

-   Multiple categories
-   Modifiers
-   Add-ons
-   Optional/required modifiers
-   Item availability
-   Time-based availability
-   Out-of-stock state

The server must revalidate availability and prices when an order is submitted.

Never trust prices coming from the browser.

----------

# 16. ORDER SYSTEM

Order lifecycle:

```
DRAFT
 ↓
SUBMITTED
 ↓
RECEIVED
 ↓
ACCEPTED
 ↓
PREPARING
 ↓
READY
 ↓
SERVED
 ↓
COMPLETED
```

Possible terminal states:

```
CANCELLED
REJECTED
```

Order creation:

1.  Validate customer/session.
2.  Validate restaurant.
3.  Validate table session.
4.  Validate menu items.
5.  Validate modifiers.
6.  Load authoritative prices from database.
7.  Calculate totals server-side.
8.  Apply promotions if available.
9.  Create order and items in a transaction.
10.  Store status history.
11.  Publish realtime event.

Historical orders must preserve price snapshots.

If the restaurant changes a menu price tomorrow, yesterday's order must remain unchanged.

----------

# 17. KITCHEN WORKFLOW

Restaurant kitchen should have a dedicated workflow.

Example:

```
New Order
   ↓
Accepted
   ↓
Preparing
   ↓
Ready
```

Kitchen staff should not need access to customer account details that are irrelevant to preparation.

Show:

-   Order number
-   Table
-   Items
-   Modifiers
-   Notes
-   Time
-   Priority/status

----------

# 18. CUSTOMER TABLE ACTIONS

Customers should eventually be able to request:

-   Waiter
-   Bill
-   Water
-   Assistance
-   Additional service

These should be represented as structured table-session requests.

Example:

```
Table 12
  Request: BILL
  Status: PENDING
```

Restaurant staff can acknowledge and complete the request.

----------

# 19. RESERVATION SYSTEM

Reservation states:

```
PENDING_PAYMENT
PENDING_CONFIRMATION
CONFIRMED
ARRIVED
SEATED
COMPLETED
CANCELLED
NO_SHOW
EXPIRED
```

Reservation creation must prevent double booking.

Use:

-   Transactional logic
-   Table holds
-   Expiration
-   Database constraints where possible
-   Concurrency-safe checks

Example:

```
Customer requests 19:00
        ↓
Temporary table hold
        ↓
Payment / confirmation
        ↓
Confirmed
```

If payment is not completed within the configured hold period, the hold expires.

----------

# 20. RESERVATION AVAILABILITY

Availability must consider:

-   Location
-   Date
-   Time
-   Number of guests
-   Table capacity
-   Existing reservations
-   Active holds
-   Blocked tables
-   Restaurant opening hours

Do not simply return all tables as available.

----------

# 21. PAYMENT SYSTEM

Payment statuses:

```
PENDING
PROCESSING
SUCCEEDED
FAILED
CANCELLED
REFUNDED
PARTIALLY_REFUNDED
```

Payment architecture must use an abstraction.

Example:

```
Application
    ↓
PaymentService
    ↓
PaymentProvider
    ├── Provider A
    ├── Provider B
    └── Provider C
```

Payment webhooks must be:

-   Signature verified
-   Idempotent
-   Logged
-   Safely retried

Never trust a client-side "payment successful" flag.

Only the server/provider verification can confirm payment.

----------

# 22. BILLING

Bills must be immutable once finalized except through explicit adjustment/refund flows.

A bill should preserve:

-   Item
-   Quantity
-   Unit price
-   Modifier prices
-   Discounts
-   Taxes
-   Fees
-   Total

Historical financial data must never be physically deleted.

----------

# 23. SPLIT BILL

Support:

1.  Equal split
2.  Pay own items
3.  Selected items
4.  Pay for another customer

Server must calculate remaining balance.

Never allow the same amount to be paid twice.

Use transactional payment/balance updates.

----------

# 24. REVIEWS

Reviews should normally be available only after a completed interaction.

Eligible events:

-   Completed reservation
-   Completed order
-   Completed table session

Review states:

```
PENDING
PUBLISHED
HIDDEN
REJECTED
```

Restaurant can respond.

Admin can moderate.

Do not allow arbitrary users to create fake verified reviews.

----------

# 25. CUSTOMER ACCOUNT

Customer profile may include:

-   Name
-   Email
-   Phone
-   Avatar
-   Favorites
-   Reservations
-   Orders
-   Reviews
-   Loyalty data later

Customer should not be forced to register for basic QR menu browsing.

Guest ordering should be possible where restaurant policy allows it.

----------

# 26. RESTAURANT DISCOVERY

Customer discovery should support:

-   Search
-   Categories
-   Cuisine
-   Location
-   Map
-   Distance
-   Price range
-   Availability
-   Favorites
-   Reviews

Restaurant pages should include:

-   Name
-   Photos
-   Description
-   Location
-   Opening hours
-   Contact
-   Menu
-   Reservation availability
-   Reviews

----------

# 27. NOTIFICATIONS

Notification events may include:

-   Reservation created
-   Reservation confirmed
-   Reservation cancelled
-   Reservation reminder
-   Payment successful
-   Payment failed
-   Order received
-   Order status changed
-   Refund
-   Restaurant announcements

Channels:

-   In-app
-   Web push
-   Email
-   SMS later

Do not make SMS a core dependency of the MVP.

----------

# 28. REALTIME

Use WebSocket/Socket.IO where realtime behavior provides meaningful value.

Important events:

```
ORDER_CREATED
ORDER_ACCEPTED
ORDER_PREPARING
ORDER_READY
ORDER_SERVED

RESERVATION_CONFIRMED
RESERVATION_CANCELLED

TABLE_SESSION_UPDATED

PAYMENT_UPDATED
```

Realtime messages are not the source of truth.

After important realtime events, clients should refetch authoritative server state where appropriate.

----------

# 29. 1C / POS INTEGRATION

Do not assume all 1C installations expose the same API.

Create an integration layer.

Concept:

```
interface POSProvider {
  getMenu(): Promise<ExternalMenu>;
  syncMenu(): Promise<SyncResult>;
  getTables(): Promise<ExternalTable[]>;
  createOrder(input: ExternalOrder): Promise<ExternalOrderResult>;
  updateOrder(input: ExternalOrderUpdate): Promise<void>;
  closeBill(input: CloseBillInput): Promise<void>;
}
```

Potential adapters:

```
POSProvider
 ├── OneCProvider
 ├── IikoProvider
 ├── CustomPOSProvider
 └── FutureProvider
```

Start without POS integrations.

The restaurant must be able to operate completely through the platform dashboard.

Integrations should be added one by one after the core product is stable.

----------

# 30. SECURITY REQUIREMENTS

Security is a first-class requirement.

Never trust:

-   Client prices
-   Client totals
-   Client roles
-   Client restaurant IDs
-   Client payment status
-   Client ownership claims
-   Client permissions

Always validate on the server.

Important security rules:

-   Tenant isolation
-   RBAC
-   Server-side authorization
-   Zod validation
-   Secure sessions
-   Secure QR tokens
-   Rate limiting
-   CSRF protection where applicable
-   Secure headers
-   Webhook signature verification
-   Idempotency
-   Audit logging
-   Input sanitization
-   File upload validation

Never expose secrets to the client.

Never hardcode credentials.

----------

# 31. FILE UPLOADS

Restaurant users can upload:

-   Restaurant images
-   Menu item images
-   Logo
-   Gallery images

Validate:

-   MIME type
-   File size
-   File extension
-   Image dimensions where necessary

Use object storage.

Do not store large image binaries in PostgreSQL.

----------

# 32. DATABASE PRINCIPLES

Use PostgreSQL with Drizzle ORM.

Important entities:

```
users
roles
restaurants
restaurant_locations
restaurant_staff
tables
qr_tokens
table_sessions
table_session_members
menus
menu_categories
menu_items
modifier_groups
modifiers
reservations
reservation_holds
orders
order_items
order_item_modifiers
order_status_history
bills
bill_items
payments
payment_events
reviews
review_responses
notifications
audit_logs
integrations
integration_events
```

Add indexes based on real query patterns.

Use foreign keys.

Use unique constraints where required.

Do not use soft deletion everywhere by default.

Financial records and audit records must be retained.

----------

# 33. API DESIGN

Use consistent API patterns.

Example:

```
/api/restaurants
/api/restaurants/:restaurantId
/api/locations/:locationId
/api/locations/:locationId/tables
/api/locations/:locationId/menu
/api/orders
/api/orders/:orderId
/api/reservations
/api/payments
```

API responses should have predictable structures.

Example:

```
{
  data: ...,
  error: null
}
```

or:

```
{
  data: null,
  error: {
    code: "ORDER_NOT_FOUND",
    message: "Order not found"
  }
}
```

Do not expose raw database errors to customers.

----------

# 34. ERROR HANDLING

Create typed application errors.

Examples:

```
UNAUTHORIZED
FORBIDDEN
NOT_FOUND
VALIDATION_ERROR
CONFLICT
RESOURCE_UNAVAILABLE
PAYMENT_FAILED
RESERVATION_UNAVAILABLE
ORDER_UNAVAILABLE
RATE_LIMITED
INTERNAL_ERROR
```

Errors should be meaningful to developers and safe for users.

----------

# 35. UI / UX PRINCIPLES

## Customer

Customer UI must be:

-   Mobile-first
-   Fast
-   Simple
-   Accessible
-   Touch-friendly
-   Minimal
-   Clear

A customer standing inside a restaurant should be able to order quickly.

Avoid unnecessary onboarding.

## Restaurant Dashboard

Restaurant dashboard should be:

-   Desktop-first
-   Responsive
-   Data-oriented
-   Operationally clear

Prioritize:

-   Orders
-   Kitchen
-   Reservations
-   Tables
-   Menu

## Admin

Admin should prioritize:

-   Monitoring
-   Moderation
-   Restaurants
-   Users
-   Payments
-   Analytics

----------

# 36. DESIGN SYSTEM

Use:

-   Tailwind CSS v4
-   shadcn/ui
-   Lucide

Do not introduce multiple UI libraries unless there is a strong reason.

Build reusable components.

Examples:

```
Button
Input
Select
Dialog
Drawer
Sheet
Tabs
Table
Badge
Card
Toast
Dropdown
Command
Form
Skeleton
EmptyState
ErrorState
```

Every important page must have:

-   Loading state
-   Empty state
-   Error state
-   Success state

----------

# 37. ACCESSIBILITY

Follow accessible UI practices.

Requirements:

-   Semantic HTML
-   Keyboard navigation
-   Visible focus states
-   Proper labels
-   Accessible dialogs
-   Accessible forms
-   Sufficient contrast
-   Alt text for meaningful images
-   Do not rely only on color

----------

# 38. INTERNATIONALIZATION

The architecture should support multiple languages.

Start with:

-   Armenian
-   English

The localization layer must allow future languages.

Do not hardcode user-facing strings throughout components.

Use a centralized translation strategy.

----------

# 39. SEO

Public restaurant pages should be SEO-friendly.

Use:

-   Server-rendered content
-   Metadata
-   Open Graph
-   Structured data where appropriate
-   Canonical URLs
-   Sitemap
-   Robots configuration

Private dashboards do not need SEO optimization.

----------

# 40. PERFORMANCE

Prioritize:

-   Server Components where appropriate
-   Dynamic imports
-   Image optimization
-   Lazy loading
-   Efficient database queries
-   Pagination
-   Caching
-   Redis where appropriate
-   Avoid unnecessary client-side JavaScript

Do not prematurely optimize everything.

Measure first.

----------

# 41. OBSERVABILITY

Important operations should be observable.

Track:

-   API errors
-   Payment failures
-   Reservation conflicts
-   Order failures
-   Integration failures
-   Webhook failures
-   Slow requests
-   Database errors

Use structured logging.

Never log:

-   Passwords
-   Payment secrets
-   Authentication tokens
-   Sensitive personal information unnecessarily

----------

# 42. TESTING STRATEGY

Critical business logic requires tests.

## Unit Tests

Test:

-   Price calculation
-   Reservation availability
-   Table capacity
-   Split bill
-   Order totals
-   Promotion calculation
-   Payment state transitions

## Integration Tests

Test:

-   Database operations
-   Authentication
-   Authorization
-   Order creation
-   Reservation creation
-   Payment events

## E2E Tests

Critical flows:

```
Customer:
QR → Menu → Cart → Order → Order Status

Customer:
Discovery → Reservation → Confirmation

Restaurant:
Login → Menu → Table → QR → Order

Restaurant:
Order → Kitchen → Ready → Served
```

----------

# 43. MVP SCOPE

## MUST HAVE

### Customer

-   QR access
-   Restaurant context
-   Menu
-   Categories
-   Item details
-   Cart
-   Order
-   Order status
-   Request bill

### Restaurant

-   Registration
-   Restaurant profile
-   Location
-   Tables
-   QR generation
-   Menu management
-   Order dashboard
-   Basic kitchen workflow

### Platform

-   Authentication
-   RBAC
-   Restaurant approval
-   Basic admin

## SHOULD HAVE

-   Reservations
-   Customer accounts
-   Reviews
-   Basic notifications
-   Basic analytics

## LATER

-   Advanced split bill
-   Loyalty
-   Promotions
-   CRM
-   Advanced analytics
-   POS integrations
-   1C integrations
-   AI features
-   Advanced marketing automation

Do not allow "LATER" features to block the MVP.

----------

# 44. IMPLEMENTATION PHASES

Implement in this order.

## Phase 1 — Foundation

-   Project setup
-   TypeScript
-   Tailwind
-   shadcn
-   Database
-   Drizzle
-   Environment configuration
-   Error handling
-   Logging
-   Basic layout

## Phase 2 — Authentication

-   Auth
-   Sessions
-   User model
-   Roles
-   RBAC

## Phase 3 — Restaurant

-   Restaurant onboarding
-   Restaurant profile
-   Locations
-   Staff

## Phase 4 — Menu

-   Menus
-   Categories
-   Items
-   Modifiers
-   Availability
-   Images

## Phase 5 — Tables and QR

-   Tables
-   QR tokens
-   QR generation
-   QR resolution
-   Table sessions

## Phase 6 — Ordering

-   Cart
-   Order creation
-   Order statuses
-   Order history
-   Kitchen workflow

## Phase 7 — Realtime

-   WebSocket
-   Order events
-   Restaurant notifications

## Phase 8 — Reservations

-   Availability
-   Holds
-   Reservation creation
-   Confirmation
-   Cancellation
-   No-show

## Phase 9 — Payments

-   Provider abstraction
-   Payment records
-   Webhooks
-   Refunds
-   Deposit

## Phase 10 — Billing

-   Bill generation
-   Split bill
-   Payment balance

## Phase 11 — Reviews

-   Review eligibility
-   Review creation
-   Moderation
-   Restaurant response

## Phase 12 — Admin

-   Restaurant management
-   User management
-   Review moderation
-   Payment monitoring
-   Analytics

## Phase 13 — Integrations

-   POS abstraction
-   First POS integration
-   1C adapter architecture

----------

# 45. DEVELOPMENT WORKFLOW

Before implementing a feature:

1.  Understand the requirement.
2.  Inspect the repository.
3.  Inspect existing architecture.
4.  Identify affected modules.
5.  Check existing components/services.
6.  Create a concise implementation plan.
7.  Implement.
8.  Run typecheck.
9.  Run lint.
10.  Run relevant tests.
11.  Fix issues.
12.  Review the final implementation.
13.  Update documentation if needed.

Do not blindly rewrite existing code.

----------

# 46. CLAUDE CODE BEHAVIOR

Claude Code must behave like a senior/principal engineer.

Do:

-   Inspect before changing.
-   Reuse existing abstractions.
-   Prefer simple solutions.
-   Keep business logic server-side.
-   Keep modules cohesive.
-   Write production-quality code.
-   Validate inputs.
-   Handle errors.
-   Add tests for critical logic.
-   Keep types strict.
-   Document non-obvious decisions.

Do not:

-   Use `any`.
-   Ignore TypeScript errors.
-   Ignore lint errors.
-   Hardcode secrets.
-   Hardcode prices.
-   Trust client authorization.
-   Put database logic inside UI components.
-   Duplicate business logic.
-   Create unnecessary abstractions.
-   Introduce microservices prematurely.
-   Install packages without a reason.
-   Delete working functionality without understanding it.
-   Build fake production APIs.
-   Leave TODOs for core functionality unless explicitly requested.

----------

# 47. TYPESCRIPT RULES

Use strict TypeScript.

Prefer:

```
type
interface
unknown
generics
discriminated unions
```

Avoid:

```
any
as any
@ts-ignore
@ts-expect-error
```

Only use an exception when technically necessary and document why.

Do not silence compiler errors to make a build pass.

----------

# 48. DATABASE RULES

Never manually modify production schema without a migration.

Use Drizzle migrations.

Every schema change should be reproducible.

Do not:

-   Delete columns casually
-   Remove financial history
-   Remove audit history
-   Use uncontrolled destructive migrations

For destructive migrations, explicitly review consequences.

----------

# 49. BUSINESS INVARIANTS

These rules must never be violated.

1.  A restaurant cannot access another restaurant's private data.
2.  A customer cannot modify another customer's order.
3.  Client-provided prices are never authoritative.
4.  Client-provided payment status is never authoritative.
5.  QR tokens must be non-predictable.
6.  Revoked QR tokens cannot create valid sessions.
7.  Two customers cannot successfully reserve the same table at the same time.
8.  An unavailable item cannot be ordered.
9.  Historical orders preserve historical prices.
10.  Financial records cannot be silently deleted.
11.  Payment webhooks must be idempotent.
12.  Roles must be validated server-side.
13.  Restaurant ownership must be validated server-side.
14.  Critical state changes must be auditable.

----------

# 50. ENVIRONMENT VARIABLES

Use environment variables for all secrets and external services.

Example:

```
DATABASE_URL=
REDIS_URL=

AUTH_SECRET=
AUTH_URL=

GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=

STORAGE_ENDPOINT=
STORAGE_ACCESS_KEY=
STORAGE_SECRET_KEY=
STORAGE_BUCKET=

MAPBOX_TOKEN=

PAYMENT_PROVIDER_KEY=
PAYMENT_WEBHOOK_SECRET=

SENTRY_DSN=
POSTHOG_KEY=
```

Do not commit `.env`.

Provide `.env.example`.

Never put secret values in source code.

----------

# 51. GIT RULES

Use meaningful commits.

Examples:

```
feat: add restaurant onboarding
feat: add table QR management
feat: add order workflow
feat: add reservation availability
fix: prevent duplicate reservation
fix: validate order prices server-side
refactor: extract payment provider interface
```

Do not create giant unrelated commits.

----------

# 52. DOCUMENTATION

Maintain documentation for:

-   Architecture
-   Database
-   API
-   Environment variables
-   Setup
-   Deployment
-   Business rules
-   Integrations

If a major architectural decision changes, update the relevant documentation.

----------

# 53. DEPLOYMENT

Recommended initial deployment:

```
Next.js
   ↓
Vercel

PostgreSQL
   ↓
Managed PostgreSQL provider

Redis
   ↓
Managed Redis provider

Storage
   ↓
Cloudflare R2 / S3
```

The exact providers can change.

Avoid provider-specific coupling where unnecessary.

----------

# 54. MONETIZATION ARCHITECTURE

Do not implement monetization into the MVP.

But design the data model so future plans can support:

```
Subscription
Plan
Feature Entitlement
Invoice
Platform Fee
Restaurant Billing Account
```

Do not activate these features during Year 1 unless explicitly requested.

----------

# 55. PRODUCT PRINCIPLES

The product should follow these principles:

### Simple for customers

A customer should not need to understand how the system works.

### Useful for restaurants

The system must save operational effort, not create additional work.

### Mobile-first for customers

The restaurant QR experience is primarily mobile.

### Operationally reliable

Restaurant staff depend on orders and reservations.

### Secure by default

Never trust the browser.

### Modular

Features must be replaceable and extensible.

### Integration-friendly

Restaurants should not be forced to replace existing systems.

### Free-first

Year 1 is about adoption and validation.

----------

# 56. FIRST PRODUCTION TARGET

The first successful production flow should be:

```
Restaurant registers
        ↓
Admin approves
        ↓
Restaurant creates menu
        ↓
Restaurant creates tables
        ↓
Platform generates QR
        ↓
Restaurant places QR on table
        ↓
Customer scans QR
        ↓
Customer sees restaurant/table
        ↓
Customer views menu
        ↓
Customer adds items
        ↓
Customer submits order
        ↓
Restaurant receives order
        ↓
Kitchen processes order
        ↓
Customer receives realtime status
        ↓
Customer requests bill
```

If this flow works reliably with real restaurants, the foundation of the product exists.

----------

# 57. IMPORTANT: DO NOT OVERBUILD

The first version should NOT attempt to build:

-   Full ERP
-   Full POS replacement
-   Complex accounting
-   Complex inventory management
-   Full CRM
-   Advanced loyalty
-   AI recommendation engine
-   Microservices
-   Native mobile applications
-   Dozens of integrations

Build the smallest reliable system that creates real value.

----------

# 58. DEFINITION OF DONE

A feature is not complete simply because the UI exists.

A feature is complete when:

-   UI exists
-   Server logic exists
-   Validation exists
-   Authorization exists
-   Database integration exists
-   Error states exist
-   Loading states exist
-   Empty states exist
-   Critical tests exist
-   TypeScript passes
-   Lint passes
-   No obvious security issue exists
-   Documentation is updated if necessary

----------

# 59. STARTING INSTRUCTION FOR CLAUDE CODE

When this project is first opened:

1.  Read this entire CLAUDE.md.
2.  Inspect the existing repository.
3.  Identify the current framework and dependencies.
4.  Inspect package.json.
5.  Inspect the source tree.
6.  Inspect existing database/schema files.
7.  Inspect existing environment configuration.
8.  Identify what already exists.
9.  Do not immediately rewrite the project.
10.  Produce a concise implementation assessment.
11.  Identify the first missing foundation.
12.  Implement the project incrementally according to this document.

If the repository is empty, initialize the architecture described above.

If an existing implementation conflicts with this document, inspect it first and determine whether it should be migrated or preserved.

Never destroy existing functionality without understanding its purpose.

----------

# 60. FINAL PRODUCT GOAL

The final platform should feel like a modern digital layer for restaurants:

```
                    CUSTOMER
                       │
        ┌──────────────┼──────────────┐
        ↓              ↓              ↓
    DISCOVERY      RESERVATION       QR
        │              │              │
        └──────────────┼──────────────┘
                       ↓
                    RESTAURANT
                       │
       ┌───────────────┼────────────────┐
       ↓               ↓                ↓
     MENU            ORDERS           TABLES
       │               │                │
       └───────────────┼────────────────┘
                       ↓
                    KITCHEN
                       ↓
                     BILL
                       ↓
                   PAYMENT
                       ↓
                    REVIEW
                       ↓
                 RETURN CUSTOMER
```

The long-term goal is not simply to create another QR menu.

The goal is to build a platform that makes the entire restaurant experience easier for both sides.

Year 1:

> Build → Launch → Learn → Improve → Grow

Do not optimize for revenue before product-market validation.

The first priority is to make restaurants genuinely want to use the platform and customers genuinely find it useful.
