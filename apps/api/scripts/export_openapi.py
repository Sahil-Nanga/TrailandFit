"""Print the OpenAPI schema as JSON, without starting a server (used by `pnpm gen:api`)."""

import json
import sys

from app.main import app

json.dump(app.openapi(), sys.stdout, indent=2, sort_keys=True)
sys.stdout.write("\n")
