////////////////////////////////////////////////////////////////////////////
//
// Copyright 2020 Realm Inc.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
// http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
//
////////////////////////////////////////////////////////////////////////////

import { MongoDBRealmError } from "./MongoDBRealmError";
import {
    NetworkTransport,
    Request,
    ResponseHandler,
    Headers,
    Fetch,
    AbortController,
} from "./types";

export class DefaultNetworkTransport implements NetworkTransport {
    public static fetch: Fetch;
    public static AbortController: AbortController;

    public static DEFAULT_HEADERS = {
        Accept: "application/json",
        "Content-Type": "application/json",
    };

    constructor() {
        if (!DefaultNetworkTransport.fetch) {
            throw new Error(
                "DefaultNetworkTransport.fetch must be set before it's used",
            );
        }
        if (!DefaultNetworkTransport.AbortController) {
            throw new Error(
                "DefaultNetworkTransport.AbortController must be set before it's used",
            );
        }
    }

    public async fetchAndParse<
        RequestBody extends any,
        ResponseBody extends any
    >(request: Request<RequestBody>): Promise<ResponseBody> {
        try {
            const response = await this.fetch(request);
            const contentType = response.headers.get("content-type");
            if (response.ok) {
                if (contentType === null) {
                    return null as any;
                } else if (contentType.startsWith("application/json")) {
                    // Awaiting the response to ensure we'll throw our own error
                    return await response.json();
                } else {
                    throw new Error("Expected an empty or a JSON response");
                }
            } else if (
                contentType &&
                contentType.startsWith("application/json")
            ) {
                throw new MongoDBRealmError(
                    request.method,
                    request.url,
                    response.status,
                    response.statusText,
                    await response.json(),
                );
            } else {
                throw new Error(
                    `Unexpected status code (${response.status} ${response.statusText})`,
                );
            }
        } catch (err) {
            if (err instanceof MongoDBRealmError) {
                throw err;
            } else {
                throw new Error(
                    `Request failed (${request.method} ${request.url}): ${err.message}`,
                );
            }
        }
    }

    public fetchWithCallbacks<RequestBody extends any>(
        request: Request<RequestBody>,
        handler: ResponseHandler,
    ) {
        // tslint:disable-next-line: no-console
        this.fetch(request)
            .then(async response => {
                const decodedBody = await response.text();
                // Pull out the headers of the response
                const responseHeaders: Headers = {};
                response.headers.forEach((value, key) => {
                    responseHeaders[key] = value;
                });
                return {
                    statusCode: response.status,
                    headers: responseHeaders,
                    body: decodedBody,
                };
            })
            .then(r => handler.onSuccess(r))
            .catch(e => handler.onError(e));
    }

    private async fetch<RequestBody extends any>(
        request: Request<RequestBody>,
    ) {
        const {
            method,
            url,
            body,
            timeoutMs,
            headers = DefaultNetworkTransport.DEFAULT_HEADERS,
        } = request;
        const { signal, cancelTimeout } = this.createTimeoutSignal(timeoutMs);
        try {
            // We'll await the response to catch throw our own error
            return await DefaultNetworkTransport.fetch(url, {
                method,
                headers,
                body: typeof body === "string" ? body : JSON.stringify(body),
                signal, // Used to signal timeouts
            });
        } finally {
            // Whatever happens, cancel any timeout
            cancelTimeout();
        }
    }

    private createTimeoutSignal(timeoutMs: number | undefined) {
        if (typeof timeoutMs === "number") {
            const controller = new DefaultNetworkTransport.AbortController();
            // Call abort after a specific number of milliseconds
            const timeout = setTimeout(() => {
                controller.abort();
            }, timeoutMs);
            return {
                signal: controller.signal,
                cancelTimeout: () => {
                    clearTimeout(timeout);
                },
            };
        } else {
            return {
                signal: undefined,
                cancelTimeout: () => {
                    /* No-op */
                },
            };
        }
    }
}
