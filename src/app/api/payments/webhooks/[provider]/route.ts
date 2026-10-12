import { ok, route } from "@/server/http/response";
import { handlePaymentWebhook } from "@/server/services/payment-service";

/**
 * POST from a payment provider (§21). Cross-site and cookie-less by nature,
 * so no same-origin check: the provider's signature is the authentication.
 * 2xx = handled (or safely ignored); 401 = bad signature; 5xx = retry later.
 */
export const POST = route(
  async (request: Request, { params }: RouteContext<"/api/payments/webhooks/[provider]">) => {
    const { provider } = await params;
    return ok(await handlePaymentWebhook(provider, request));
  },
);
