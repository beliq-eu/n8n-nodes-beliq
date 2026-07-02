import type {
	IAuthenticateGeneric,
	ICredentialTestRequest,
	ICredentialType,
	INodeProperties,
} from 'n8n-workflow';

export class BeliqApi implements ICredentialType {
	name = 'beliqApi';

	displayName = 'Beliq API';

	documentationUrl = 'https://docs.beliq.eu';

	properties: INodeProperties[] = [
		{
			displayName: 'API Key',
			name: 'apiKey',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			required: true,
			description: 'Your beliq API key. Create one in the beliq dashboard under API Keys.',
		},
	];

	authenticate: IAuthenticateGeneric = {
		type: 'generic',
		properties: {
			headers: {
				Authorization: '=Bearer {{$credentials.apiKey}}',
			},
		},
	};

	// Validates the key against GET /v1/me, a no-quota credential check: 200 for
	// a valid key, 401/403 for an invalid one. It never consumes the monthly
	// quota and reaches no engine work.
	test: ICredentialTestRequest = {
		request: {
			baseURL: 'https://api.beliq.eu',
			url: '/v1/me',
			method: 'GET',
		},
	};
}
