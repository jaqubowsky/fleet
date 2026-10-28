# Doubles

## What gets a double at all

Shared or volatile dependency takes a double. Private, in-process and deterministic stays a real object. "System boundary" is an approximation of that rule, not the rule: a cache shared between tests is shared without being a boundary, and a database with a fresh container per test is private while staying one.

```typescript
// GOOD: the pure collaborator stays real, only the volatile one is replaced
const pricing = new PriceCalculator(stubRates({ EUR_PLN: 4.3 }));
const service = new OrderService(new InMemoryOrders(), pricing);

// BAD: PriceCalculator is private, deterministic logic, so the test now
// asserts against a made-up price instead of the real pricing rule
const service = new OrderService(mockOrders, mockPriceCalculator);
```

## The five kinds

`vi.fn()` and `jest.fn()` build all of them. What you do with the object decides which one it is.

**Dummy** fills a signature and is never called in this scenario.

```typescript
const service = new OrderService(orders, pricing, neverCalled<Clock>());
```

**Stub** feeds data in so the test controls its inputs. Never assert on a stub: it returns what you told it to.

```typescript
const rates: ExchangeRates = () => Promise.resolve({ EUR_PLN: 4.3 });
```

**Fake** is a working lightweight implementation, usually hand-written.

```typescript
class InMemoryOrders implements Orders {
  private readonly rows = new Map<OrderId, Order>();
  save = async (order: Order) => void this.rows.set(order.id, order);
  byId = async (id: OrderId) => this.rows.get(id);
}
```

**Mock** verifies that an outgoing interaction happened. Its job is the assertion, not the return value.

**Spy** is both: it answers like a stub and records calls, or wraps a real object or fake to track what went through it.

## When a mock is the right answer

Use one for a side effect that neither the return value nor any reachable state can show: an email sent, an external system notified, an analytics event emitted. There is nothing else to assert on, so asserting the call is the behavior.

```typescript
// GOOD: the confirmation email leaves the system, so the call IS the behavior
const sendEmail = vi.fn<[Email], Promise<void>>().mockResolvedValue();

await placeOrder(order, { sendEmail, charge });

expect(sendEmail).toHaveBeenCalledWith(
  expect.objectContaining({ to: "anna@example.com", template: "order-confirmed" }),
);
```

```typescript
// BAD: the saved order IS observable, so verifying the call tests the mechanism.
// This breaks when save(order) becomes saveAll([order]) with behavior unchanged
expect(orders.save).toHaveBeenCalledWith(order);

// GOOD: assert what the fake holds
expect(await orders.byId(order.id)).toMatchObject({ total: money("300.00", "PLN") });
```

Two more tells that a mock is doing the wrong job: asserting call counts or call order when the count is not itself the rule ("charge the card once" is a rule, "the repository was hit twice" is not), and a mock whose return value is another mock, which means the test is now describing a call graph.

## Shape the dependency so there is nothing to mock

A slice that declares what it needs as a narrow function type in its own vocabulary removes most of this. The composition root decides where the implementation comes from, and the handler cannot tell a stub from an in-memory implementation from a real client pointed at a sandbox.

```typescript
// GOOD: the dependency is a function type, so the stub is one line
type ChargeCard = (amount: Money) => Promise<PaymentResult>;

async function placeOrder(order: Order, chargeCard: ChargeCard) {
  return chargeCard(order.total);
}

// BAD: the client is built inside, so the only way in is intercepting the module
async function placeOrder(order: Order) {
  const stripe = new StripeClient(process.env.STRIPE_KEY);
  return stripe.charge(order.total);
}
```
