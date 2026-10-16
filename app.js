import { readFile, writeFile, mkdir } from "fs/promises";
import { createServer } from "http";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT || 3000;

const PUBLIC_DIR = path.join(__dirname, "public");
const DATA_DIR = path.join(__dirname, "data");
const DATA_FILE = path.join(DATA_DIR, "links.json");

// Initialize the JSON file used to store shortened URLs.
const initializeDataFile = async () => {
  await mkdir(DATA_DIR, { recursive: true });

  try {
    await readFile(DATA_FILE, "utf-8");
  } catch (error) {
    if (error.code === "ENOENT") {
      await writeFile(DATA_FILE, "{}", "utf-8");
    } else {
      throw error;
    }
  }
};

const serverFile = async (res, filePath, contentType) => {
  try {
    const data = await readFile(filePath);

    res.writeHead(200, {
      "Content-Type": contentType,
    });

    return res.end(data);
  } catch (error) {
    console.error("Error reading file:", error.message);

    res.writeHead(404, {
      "Content-Type": "text/plain; charset=utf-8",
    });

    return res.end("404 Page Not Found");
  }
};

const loadLinks = async () => {
  const data = await readFile(DATA_FILE, "utf-8");

  if (!data.trim()) {
    return {};
  }

  return JSON.parse(data);
};

const saveLinks = async (links) => {
  await writeFile(DATA_FILE, JSON.stringify(links, null, 2), "utf-8");
};

// Handle incoming HTTP requests.
const server = createServer(async (req, res) => {
  try {
    const requestURL = new URL(
      req.url,
      `http://${req.headers.host || `localhost:${PORT}`}`,
    );

    const pathname = requestURL.pathname;

    if (req.method === "GET") {
      if (pathname === "/") {
        return await serverFile(
          res,
          path.join(PUBLIC_DIR, "index.html"),
          "text/html; charset=utf-8",
        );
      }

      if (pathname === "/style.css") {
        return await serverFile(
          res,
          path.join(PUBLIC_DIR, "style.css"),
          "text/css; charset=utf-8",
        );
      }

      // Return all saved shortened URLs as JSON.
      if (pathname === "/links") {
        const links = await loadLinks();

        res.writeHead(200, {
          "Content-Type": "application/json; charset=utf-8",
        });

        return res.end(JSON.stringify(links));
      }

      let shortCode;

      try {
        shortCode = decodeURIComponent(pathname.slice(1));
      } catch {
        res.writeHead(400, {
          "Content-Type": "text/plain; charset=utf-8",
        });

        return res.end("Invalid shortened URL.");
      }

      const links = await loadLinks();

      if (!Object.hasOwn(links, shortCode)) {
        res.writeHead(404, {
          "Content-Type": "text/plain; charset=utf-8",
        });

        return res.end("Shortened URL was not found.");
      }

      let parsedURL;

      try {
        parsedURL = new URL(links[shortCode]);
      } catch {
        res.writeHead(500, {
          "Content-Type": "text/plain; charset=utf-8",
        });

        return res.end("The saved original URL is invalid.");
      }

      if (parsedURL.protocol !== "http:" && parsedURL.protocol !== "https:") {
        res.writeHead(400, {
          "Content-Type": "text/plain; charset=utf-8",
        });

        return res.end("Only HTTP and HTTPS URLs are supported.");
      }

      // Redirect the short URL to its original destination.
      res.writeHead(302, {
        Location: parsedURL.href,
      });

      return res.end();
    }

    if (req.method === "POST" && pathname === "/shorten") {
      let body = "";

      for await (const chunk of req) {
        body += chunk;

        if (body.length > 100_000) {
          res.writeHead(413, {
            "Content-Type": "text/plain; charset=utf-8",
          });

          return res.end("Request body is too large.");
        }
      }

      let requestData;

      try {
        requestData = JSON.parse(body);
      } catch {
        res.writeHead(400, {
          "Content-Type": "text/plain; charset=utf-8",
        });

        return res.end("Invalid JSON request.");
      }

      const { url, shortCode } = requestData ?? {};

      if (typeof url !== "string" || !url.trim()) {
        res.writeHead(400, {
          "Content-Type": "text/plain; charset=utf-8",
        });

        return res.end("URL is required.");
      }

      const originalURL = url.trim();
      let parsedURL;

      try {
        parsedURL = new URL(originalURL);
      } catch {
        res.writeHead(400, {
          "Content-Type": "text/plain; charset=utf-8",
        });

        return res.end("Please enter a valid URL.");
      }

      if (parsedURL.protocol !== "http:" && parsedURL.protocol !== "https:") {
        res.writeHead(400, {
          "Content-Type": "text/plain; charset=utf-8",
        });

        return res.end("Only HTTP and HTTPS URLs are supported.");
      }

      if (typeof shortCode !== "string" || !shortCode.trim()) {
        res.writeHead(400, {
          "Content-Type": "text/plain; charset=utf-8",
        });

        return res.end("Short code is required.");
      }

      const finalShortCode = shortCode.trim();

      if (!/^[a-zA-Z0-9_-]+$/.test(finalShortCode)) {
        res.writeHead(400, {
          "Content-Type": "text/plain; charset=utf-8",
        });

        return res.end(
          "Short code can contain only letters, numbers, hyphens, and underscores.",
        );
      }

      const reservedCodes = ["links", "shorten"];

      if (reservedCodes.includes(finalShortCode.toLowerCase())) {
        res.writeHead(400, {
          "Content-Type": "text/plain; charset=utf-8",
        });

        return res.end("This short code is reserved.");
      }

      const links = await loadLinks();

      if (Object.hasOwn(links, finalShortCode)) {
        res.writeHead(400, {
          "Content-Type": "text/plain; charset=utf-8",
        });

        return res.end("Short code already exists. Please choose another.");
      }

      links[finalShortCode] = parsedURL.href;
      await saveLinks(links);

      res.writeHead(200, {
        "Content-Type": "application/json; charset=utf-8",
      });

      return res.end(
        JSON.stringify({
          success: true,
          shortCode: finalShortCode,
        }),
      );
    }

    // Delete a shortened URL and update the saved data.
    if (req.method === "DELETE" && pathname.startsWith("/links/")) {
      let shortCode;

      try {
        shortCode = decodeURIComponent(pathname.slice("/links/".length));
      } catch {
        res.writeHead(400, {
          "Content-Type": "text/plain; charset=utf-8",
        });

        return res.end("Invalid short code.");
      }

      if (!shortCode || shortCode.includes("/")) {
        res.writeHead(400, {
          "Content-Type": "text/plain; charset=utf-8",
        });

        return res.end("Invalid short code.");
      }

      const links = await loadLinks();

      if (!Object.hasOwn(links, shortCode)) {
        res.writeHead(404, {
          "Content-Type": "text/plain; charset=utf-8",
        });

        return res.end("Shortened URL was not found.");
      }

      delete links[shortCode];
      await saveLinks(links);

      res.writeHead(200, {
        "Content-Type": "application/json; charset=utf-8",
      });

      return res.end(JSON.stringify({ success: true }));
    }

    res.writeHead(404, {
      "Content-Type": "text/plain; charset=utf-8",
    });

    return res.end("404 Page Not Found.");
  } catch (error) {
    console.error("Server error:", error);

    if (!res.headersSent) {
      res.writeHead(500, {
        "Content-Type": "text/plain; charset=utf-8",
      });
    }

    if (!res.writableEnded) {
      return res.end("Internal Server Error.");
    }
  }
});

initializeDataFile()
  .then(() => {
    server.listen(PORT, () => {
      console.log(`Server running at http://localhost:${PORT}`);
    });
  })
  .catch((error) => {
    console.error("Failed to initialize the data file:", error);
    process.exit(1);
  });
