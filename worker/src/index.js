/**
 * The worker's single entry point.
 *
 * Cloudflare runs ONE module per worker, and `main` pointed at email.js, which
 * exports only an `email` handler. The whole feed API in api.js was therefore
 * never routed - the code existed, the tests passed, and nothing served it.
 * Both handlers have to leave from the same module.
 */
import { handleEmail } from "./email.js";
import { handleFetch } from "./api.js";

export default {
  email: handleEmail,
  fetch: handleFetch,
};
