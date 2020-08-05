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

import { Fetcher } from "./Fetcher";
import { Storage } from "./storage";
import { OAuth2Helper } from "./OAuth2Helper";
import { Credentials } from "./Credentials";
import { encodeUrl } from "./utils/string";
import { User } from "./User";

// TODO: Add the deviceId to the auth response.

/**
 * The response from an authentication request.
 */
export type AuthResponse = {
    /**
     * The id of the user.
     */
    userId: string;
    /**
     * The short-living access token.
     */
    accessToken: string;
    /**
     * The refresh token for the session.
     */
    refreshToken: string | null;
};

/**
 * Handles authentication and linking of users.
 */
export class Authenticator {
    /**
     * A transport adding the base route prefix to all requests.
     */
    public readonly fetcher: Fetcher;

    /**
     * A helper used to complete an OAuth 2.0 authentication flow.
     */
    private oauth2: OAuth2Helper;

    /**
     * Constructs the Authenticator.
     *
     * @param fetcher The fetcher used to fetch responses from the server.
     * @param storage The storage used when completing OAuth 2.0 flows (should not be scoped to a specific app).
     */
    constructor(fetcher: Fetcher, storage: Storage) {
        this.fetcher = fetcher;
        this.oauth2 = new OAuth2Helper(storage, () =>
            fetcher.getAppUrl().then(({ url }) => url),
        );
    }

    /**
     * Perform the login, based on the credentials.
     *
     * @param credentials Credentials to use when logging in.
     * @param linkWithUser Should the request link with the current user?
     */
    public async authenticate(
        credentials: Credentials<any>,
        linkWithUser?: User<any, any>,
    ): Promise<AuthResponse> {
        if (
            credentials.providerType.startsWith("oauth2") &&
            typeof credentials.payload.redirectUrl === "string"
        ) {
            // Initiate the OAuth2 and use the next credentials once they're known
            const result = await this.oauth2.initiate(credentials);
            return OAuth2Helper.decodeAuthInfo(result.userAuth);
        } else {
            // See https://github.com/mongodb/stitch-js-sdk/blob/310f0bd5af80f818cdfbc3caf1ae29ffa8e9c7cf/packages/core/sdk/src/auth/internal/CoreStitchAuth.ts#L746-L780
            const appUrl = await this.fetcher.getAppUrl();
            const { url: loginUrl } = appUrl
                .authProvider(credentials.providerName)
                .login();
            const response = await this.fetcher.fetchJSON<object, any>({
                method: "POST",
                url: encodeUrl(loginUrl, {
                    link: linkWithUser ? true : undefined,
                }),
                body: credentials.payload,
                tokenType: linkWithUser ? "access" : "none",
                user: linkWithUser,
            });
            // Spread out values from the response and ensure they're valid
            const {
                user_id: userId,
                access_token: accessToken,
                refresh_token: refreshToken = null,
            } = response;
            if (typeof userId !== "string") {
                throw new Error("Expected a user id in the response");
            }
            if (typeof accessToken !== "string") {
                throw new Error("Expected an access token in the response");
            }
            return { userId, accessToken, refreshToken };
        }
    }
}
