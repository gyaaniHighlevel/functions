import {Router} from "express";
import {asyncHandler} from "../utils/async-handler";

export const docsRoutes = Router();

// Swagger UI assets load from the CDN in the browser and the OpenAPI
// builder is imported lazily on first request, so this route adds
// nothing to cold start.
let cachedSpec: object | null = null;

docsRoutes.get("/openapi.json", asyncHandler(async (_req, res) => {
  if (!cachedSpec) {
    const {buildOpenApiDocument} = await import("./openapi.js");
    cachedSpec = buildOpenApiDocument();
  }
  res.json(cachedSpec);
}));

const SWAGGER_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Genesis API docs</title>
  <link rel="stylesheet"
    href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css">
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js">
  </script>
  <script>
    // Works behind any prefix (emulator's /<project>/us-central1/api,
    // the deployed run.app URL): derive the API base from this page's path.
    const base = location.pathname.replace(/\\/docs\\/?$/, "");
    fetch(base + "/docs/openapi.json")
      .then((r) => r.json())
      .then((spec) => {
        spec.servers = [{url: base || "/"}];
        SwaggerUIBundle({
          spec,
          dom_id: "#swagger-ui",
          persistAuthorization: true,
          tryItOutEnabled: true,
        });
      });
  </script>
</body>
</html>`;

docsRoutes.get("/", (_req, res) => {
  res.type("html").send(SWAGGER_HTML);
});
