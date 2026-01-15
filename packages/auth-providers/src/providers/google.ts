import { AxiosInstance } from 'axios'
import { IOAuthProvider, OAuthToken, OAuthUser, AuthProviderConfig } from '../types.js'

export class GoogleProvider implements IOAuthProvider {
  public readonly name = 'google'

  private static readonly TOKEN_URL = 'https://oauth2.googleapis.com/token'
  private static readonly USER_INFO_URL = 'https://www.googleapis.com/oauth2/v2/userinfo'

  constructor(
    private readonly config: AuthProviderConfig,
    private readonly httpClient: AxiosInstance
  ) {}

  async exchangeToken(code: string): Promise<OAuthToken> {
    if (!this.config.clientId || !this.config.clientSecret || !this.config.redirectUri) {
      throw new Error('Google configuration missing')
    }

    const params = new URLSearchParams()
    params.append('client_id', this.config.clientId)
    params.append('client_secret', this.config.clientSecret)
    params.append('code', code)
    params.append('redirect_uri', this.config.redirectUri)
    params.append('grant_type', 'authorization_code')

    const response = await this.httpClient.post(GoogleProvider.TOKEN_URL, params, {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      }
    })

    if (response.data.error) {
      throw new Error(
        `Google OAuth error: ${response.data.error_description || response.data.error}`
      )
    }

    return response.data
  }

  async getUserInfo(accessToken: string): Promise<OAuthUser> {
    const response = await this.httpClient.get(GoogleProvider.USER_INFO_URL, {
      headers: {
        Authorization: `Bearer ${accessToken}`
      }
    })

    const data = response.data

    return {
      id: data.id,
      email: data.email,
      name: data.name || data.email?.split('@')[0],
      avatar_url: data.picture,
      raw: data
    }
  }
}
