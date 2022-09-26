import { readdir, lstat } from "fs/promises";
import { Router } from "express";

import { ALLOWED_FILE_NAMES } from "./constants.js";
import { warn, info } from "./utils/logger.js";

import requestLogger from "./core/requestLogger.js";

const preparedRouter = Router();

const loadRoutes = async (route, options = { logger: true }) => {
  const files = await readdir(route);

  if (options?.logger && !options?.baseRoute) {
    preparedRouter.use(requestLogger);
  }

  let baseRoute = options?.baseRoute ?? route;
  let availableMiddleware = options?.availableMiddleware ?? {};

  files.forEach(async (fileName) => {
    const fileRoute = `${route}/${fileName}`;
    const fileInfo = await lstat(fileRoute);

    if (fileInfo.isDirectory()) {
      return await loadRoutes(fileRoute, {
        ...options,
        baseRoute,
        availableMiddleware,
      });
    }

    // Middleware definition files
    if (/^.+\.middleware\.js$/.test(fileName)) {
      const { default: middleware } = await import(fileRoute);
      const [middlewareName] = fileName.split(".");

      return (availableMiddleware[middlewareName] = middleware);
    }

    const endpointRoute =
      route.replace(baseRoute, "") === "" ? "/" : route.replace(baseRoute, "");

    // Basic HTTP routes
    if (ALLOWED_FILE_NAMES.includes(fileName.split(".")[0])) {
      const [method] = fileName.split(".");

      try {
        const { default: routeHandler } = await import(fileRoute);

        preparedRouter[method](endpointRoute, routeHandler);

        return info(`${endpointRoute} loaded`, method);
      } catch (err) {
        if (err.message.includes("Cannot find module"))
          return warn(
            "Endpoint " +
              endpointRoute +
              " contains import errors. Ommitting...",
            method
          );

        return warn(
          `Endpoint ${endpointRoute} is missing a default export definition. Omitting route...`,
          method
        );
      }
    }

    // Routes with middleware
    if (/^.+\@.+\.js$/.test(fileName)) {
      const [method] = fileName.split("@");
      const [middleware] = fileName.split("@")[1].split(".");

      try {
        const { default: routeHandler } = await import(fileRoute);
        const selectedMiddleware = availableMiddleware[middleware];

        if (!selectedMiddleware) throw Error("middleware does not exist");

        preparedRouter[method](
          route.replace(baseRoute, ""),
          selectedMiddleware,
          routeHandler
        );

        return info(`${endpointRoute} loaded`, method);
      } catch (err) {
        if (err.message === "middleware does not exist")
          return warn(
            `The selected middleware applied on ${endpointRoute} does not exist. Ommitting creation...`,
            method
          );

        if (err.message.includes("Cannot find module"))
          return warn(
            "Endpoint " +
              endpointRoute +
              " contains import errors. Ommitting...",
            method
          );

        warn(
          `Endpoint ${endpointRoute} is missing a default export definition`,
          method
        );
      }
    }
  });

  return preparedRouter;
};

export default loadRoutes;
