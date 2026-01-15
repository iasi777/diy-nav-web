import { AxiosInstance } from 'axios'
import { IOAuthProvider, OAuthToken, OAuthUser, AuthProviderConfig } from '../types.js'

export class GitHubProvider implements IOAuthProvider {
  public readonly name = 'github'

  private static readonly TOKEN_URL = 'https://github.com/login/oauth/access_token'
  private static readonly USER_INFO_URL = 'https://api.github.com/user'
  private static readonly USER_EMAILS_URL = 'https://api.github.com/user/emails'

  constructor(
    private readonly config: AuthProviderConfig,
    private readonly httpClient: AxiosInstance
  ) {}

  async exchangeToken(code: string): Promise<OAuthToken> {
    if (!this.config.clientId || !this.config.clientSecret || !this.config.redirectUri) {
      throw new Error('GitHub configuration missing')
    }

    const response = await this.httpClient.post(
      GitHubProvider.TOKEN_URL,
      {
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
        code,
        redirect_uri: this.config.redirectUri
      },
      {
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json'
        }
      }
    )

    if (response.data.error) {
      throw new Error(
        `GitHub OAuth error: ${response.data.error_description || response.data.error}`
      )
    }

    return response.data
  }

  async getUserInfo(accessToken: string): Promise<OAuthUser> {
    const headers = {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/vnd.github+json'
    }

    // 获取用户基本信息
    const userResponse = await this.httpClient.get(GitHubProvider.USER_INFO_URL, { headers })
    const userData = userResponse.data

    // 尝试获取用户邮箱（如果用户设置了私有邮箱）
    let email = userData.email
    if (!email) {
      try {
        const emailsResponse = await this.httpClient.get(GitHubProvider.USER_EMAILS_URL, {
          headers
        })
        const primaryEmail = emailsResponse.data.find(
          (e: { primary: boolean; verified: boolean }) => e.primary && e.verified
        )
        email = primaryEmail?.email
      } catch {
        // 邮箱获取失败不影响登录
      }
    }

    return {
      id: String(userData.id),
      email,
      name: userData.login,
      avatar_url: userData.avatar_url,
      raw: userData
    }
  }
}
