import express from "express";
import cors from "cors";
import {docsRoutes} from "./docs/docs.routes";
import {errorHandler} from "./middleware/error-handler";
import {requireAuth} from "./middleware/require-auth";
import {oauthRoutes} from "./routes/oauth.routes";
import {projectRoutes} from "./routes/project.routes";
import {proxyRoutes} from "./routes/proxy.routes";
import {userRoutes} from "./routes/user.routes";

export const app = express();

app.use(cors({origin: true}));
app.use(express.json());

app.get("/healthz", (_req, res) => {
  res.json({ok: true});
});

app.use("/docs", docsRoutes);

app.use("/oauth/hl", requireAuth, oauthRoutes);
app.use("/hl", requireAuth, proxyRoutes);
app.use("/users", requireAuth, userRoutes);
app.use("/projects", requireAuth, projectRoutes);

app.use((_req, res) => {
  res.status(404).json({code: "NOT_FOUND", message: "Route not found."});
});

app.use(errorHandler);
