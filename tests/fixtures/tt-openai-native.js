// Licensed under GNU AGPL v3; see TAURITAVERN-LICENSE in this directory.
// Verbatim functions from Darkatse/TauriTavern v2.4.0, src/scripts/openai.js.
// https://github.com/Darkatse/TauriTavern/blob/v2.4.0/src/scripts/openai.js
// getStatusOpen (L6314) and onConnectButtonClick (L8055); all function bodies unchanged.

async function getStatusOpen() {
    if (isConnectionValidationSuspended()) {
        return resultCheckStatus();
    }

    const noValidateSources = [
        chat_completion_sources.CLAUDE,
        chat_completion_sources.AI21,
        chat_completion_sources.VERTEXAI,
        chat_completion_sources.PERPLEXITY,
        chat_completion_sources.ZAI,
        chat_completion_sources.MINIMAX,
    ];
    if (noValidateSources.includes(oai_settings.chat_completion_source)) {
        let status = t`Key saved; press \"Test Message\" to verify.`;
        setOnlineStatus(status);
        updateFeatureSupportFlags();
        return resultCheckStatus();
    }

    if (oai_settings.chat_completion_source === chat_completion_sources.CUSTOM && !isValidUrl(oai_settings.custom_url)) {
        console.debug('Invalid endpoint URL of Custom OpenAI API:', oai_settings.custom_url);
        setOnlineStatus(t`Invalid endpoint URL. Requests may fail.`);
        return resultCheckStatus();
    }

    if (oai_settings.chat_completion_source === chat_completion_sources.AZURE_OPENAI && !isValidUrl(oai_settings.azure_base_url)) {
        console.debug('Invalid endpoint URL of Azure OpenAI API:', oai_settings.azure_base_url);
        setOnlineStatus(t`Invalid Azure endpoint URL. Requests may fail.`);
        return resultCheckStatus();
    }

    let data = {
        reverse_proxy: oai_settings.reverse_proxy,
        proxy_password: oai_settings.proxy_password,
        chat_completion_source: oai_settings.chat_completion_source,
    };
    const secretKey = resolveSecretKey();
    const activeSecret = Array.isArray(secret_state[secretKey]) ? secret_state[secretKey].find(secret => secret.active) : null;
    if (activeSecret) {
        data.secret_id = activeSecret.id;
    }

    const validateProxySources = [
        chat_completion_sources.CLAUDE,
        chat_completion_sources.OPENAI,
        chat_completion_sources.MISTRALAI,
        chat_completion_sources.MAKERSUITE,
        chat_completion_sources.VERTEXAI,
        chat_completion_sources.DEEPSEEK,
        chat_completion_sources.XAI,
        chat_completion_sources.ZAI,
        chat_completion_sources.MOONSHOT,
    ];
    if (oai_settings.reverse_proxy && validateProxySources.includes(oai_settings.chat_completion_source)) {
        await validateReverseProxy();
    }

    applyAdditionalParametersToRequest(data, oai_settings, { includeBody: false });

    if (oai_settings.chat_completion_source === chat_completion_sources.CUSTOM) {
        $('.model_custom_select').empty();
        data.custom_api_format = oai_settings.custom_api_format;
        data.custom_url = oai_settings.custom_url;
    }

    if (oai_settings.chat_completion_source === chat_completion_sources.OPENCODE) {
        data.opencode_endpoint = oai_settings.opencode_endpoint;
        data.opencode_api_format = oai_settings.opencode_api_format;
    }

    if (oai_settings.chat_completion_source === chat_completion_sources.AZURE_OPENAI) {
        data.azure_base_url = oai_settings.azure_base_url;
        data.azure_deployment_name = oai_settings.azure_deployment_name;
        data.azure_api_version = oai_settings.azure_api_version;
    }

    if (oai_settings.chat_completion_source === chat_completion_sources.SILICONFLOW) {
        data.siliconflow_endpoint = oai_settings.siliconflow_endpoint;
    }

    if (oai_settings.chat_completion_source === chat_completion_sources.MINIMAX) {
        data.minimax_endpoint = oai_settings.minimax_endpoint;
    }

    if (oai_settings.chat_completion_source === chat_completion_sources.MOONSHOT) {
        data.moonshot_endpoint = oai_settings.moonshot_endpoint;
    }

    if (oai_settings.chat_completion_source === chat_completion_sources.POLLINATIONS) {
        data.pollinations_endpoint = oai_settings.pollinations_endpoint;
    }

    if (oai_settings.chat_completion_source === chat_completion_sources.AWS_BEDROCK) {
        data.aws_bedrock_region = (oai_settings.aws_bedrock_region || AWS_BEDROCK_REGION_DEFAULT).trim();
    }

    if (oai_settings.chat_completion_source === chat_completion_sources.WORKERS_AI) {
        data.workers_ai_account_id = oai_settings.workers_ai_account_id;
    }

    const canBypass = (oai_settings.chat_completion_source === chat_completion_sources.OPENAI && oai_settings.bypass_status_check) || oai_settings.chat_completion_source === chat_completion_sources.CUSTOM;
    if (canBypass) {
        setOnlineStatus(t`Status check bypassed`);
    }

    try {
        const response = await fetch('/api/backends/chat-completions/status', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify(data),
            signal: abortStatusCheck.signal,
            cache: 'no-cache',
        });

        if (!response.ok) {
            throw new Error(response.statusText);
        }

        const responseData = await response.json();

        if (responseData.cancelled) {
            setOnlineStatus('no_connection');
        } else {
            if ('data' in responseData && Array.isArray(responseData.data)) {
                saveModelList(responseData.data);
            }
            if (responseData.error) {
                if (!canBypass) {
                    setOnlineStatus('no_connection');
                    toastr.error(String(responseData.message || t`Could not connect to API`));
                }
            } else if (responseData.bypass) {
                setOnlineStatus(t`Status check bypassed`);
            } else {
                setOnlineStatus(t`Valid`);
            }
        }
    } catch (error) {
        console.error(error);

        if (!canBypass) {
            setOnlineStatus('no_connection');
        }
    }

    updateFeatureSupportFlags();
    return resultCheckStatus();
}

async function onConnectButtonClick(e) {
    e.stopPropagation();
    if (isConnectionValidationSuspended()) return;

    try {
        await readSecretState();

        /** @type {Object.<string, {key: string, selector: string, proxy?: boolean, keyless?: boolean}>} */
        const apiSourceConfig = {
            [chat_completion_sources.OPENROUTER]: { key: SECRET_KEYS.OPENROUTER, selector: '#api_key_openrouter', proxy: false },
            [chat_completion_sources.MAKERSUITE]: { key: SECRET_KEYS.MAKERSUITE, selector: '#api_key_makersuite', proxy: true },
            [chat_completion_sources.CLAUDE]: { key: SECRET_KEYS.CLAUDE, selector: '#api_key_claude', proxy: true },
            [chat_completion_sources.OPENAI]: { key: SECRET_KEYS.OPENAI, selector: '#api_key_openai', proxy: true },
            [chat_completion_sources.OPENCODE]: { key: SECRET_KEYS.OPENCODE, selector: '#api_key_opencode', proxy: false },
            [chat_completion_sources.AI21]: { key: SECRET_KEYS.AI21, selector: '#api_key_ai21', proxy: false },
            [chat_completion_sources.MISTRALAI]: { key: SECRET_KEYS.MISTRALAI, selector: '#api_key_mistralai', proxy: true },
            [chat_completion_sources.CUSTOM]: { key: SECRET_KEYS.CUSTOM, selector: '#api_key_custom', proxy: false, keyless: true },
            [chat_completion_sources.COHERE]: { key: SECRET_KEYS.COHERE, selector: '#api_key_cohere', proxy: false },
            [chat_completion_sources.PERPLEXITY]: { key: SECRET_KEYS.PERPLEXITY, selector: '#api_key_perplexity', proxy: false },
            [chat_completion_sources.GROQ]: { key: SECRET_KEYS.GROQ, selector: '#api_key_groq', proxy: false },
            [chat_completion_sources.SILICONFLOW]: { key: SECRET_KEYS.SILICONFLOW, selector: '#api_key_siliconflow', proxy: false },
            [chat_completion_sources.ELECTRONHUB]: { key: SECRET_KEYS.ELECTRONHUB, selector: '#api_key_electronhub', proxy: false },
            [chat_completion_sources.NANOGPT]: { key: SECRET_KEYS.NANOGPT, selector: '#api_key_nanogpt', proxy: false },
            [chat_completion_sources.DEEPSEEK]: { key: SECRET_KEYS.DEEPSEEK, selector: '#api_key_deepseek', proxy: true },
            [chat_completion_sources.XAI]: { key: SECRET_KEYS.XAI, selector: '#api_key_xai', proxy: true },
            [chat_completion_sources.AIMLAPI]: { key: SECRET_KEYS.AIMLAPI, selector: '#api_key_aimlapi', proxy: false },
            [chat_completion_sources.MOONSHOT]: { key: SECRET_KEYS.MOONSHOT, selector: '#api_key_moonshot', proxy: true },
            [chat_completion_sources.FIREWORKS]: { key: SECRET_KEYS.FIREWORKS, selector: '#api_key_fireworks', proxy: false },
            [chat_completion_sources.COMETAPI]: { key: SECRET_KEYS.COMETAPI, selector: '#api_key_cometapi', proxy: false },
            [chat_completion_sources.AZURE_OPENAI]: { key: SECRET_KEYS.AZURE_OPENAI, selector: '#api_key_azure_openai', proxy: false },
            [chat_completion_sources.ZAI]: { key: SECRET_KEYS.ZAI, selector: '#api_key_zai', proxy: true },
            [chat_completion_sources.CHUTES]: { key: SECRET_KEYS.CHUTES, selector: '#api_key_chutes', proxy: false },
            [chat_completion_sources.POLLINATIONS]: { key: SECRET_KEYS.POLLINATIONS, selector: '#api_key_pollinations', proxy: false, keyless: oai_settings.pollinations_endpoint === POLLINATIONS_ENDPOINT.ANONYMOUS },
            [chat_completion_sources.WORKERS_AI]: { key: SECRET_KEYS.WORKERS_AI, selector: '#api_key_workers_ai', proxy: false },
            [chat_completion_sources.MINIMAX]: { key: SECRET_KEYS.MINIMAX, selector: '#api_key_minimax', proxy: false },
            [chat_completion_sources.AWS_BEDROCK]: { key: SECRET_KEYS.AWS_BEDROCK, selector: '#api_key_aws_bedrock', proxy: false },
        };

        // Vertex AI Express version - use API key
        if (oai_settings.vertexai_auth_mode === 'express') {
            apiSourceConfig[chat_completion_sources.VERTEXAI] = { key: SECRET_KEYS.VERTEXAI, selector: '#api_key_vertexai', proxy: true };
        }

        if (oai_settings.chat_completion_source === chat_completion_sources.VERTEXAI
            && oai_settings.vertexai_auth_mode === 'express'
            && isVertexAiClaudeModelId()
            && !oai_settings.reverse_proxy) {
            toastr.error(t`Claude on Vertex AI requires Full mode service account authentication or a reverse proxy.`);
            return;
        }

        // Vertex AI Full version - use service account
        if (oai_settings.chat_completion_source === chat_completion_sources.VERTEXAI && oai_settings.vertexai_auth_mode === 'full') {
            if (!secret_state[SECRET_KEYS.VERTEXAI_SERVICE_ACCOUNT]) {
                toastr.error(t`Service Account JSON is required for Vertex AI full version. Please validate and save your Service Account JSON.`);
                return;
            }
        }

        // Other generic configs
        const config = apiSourceConfig[oai_settings.chat_completion_source];
        if (config) {
            const apiKey = String($(config.selector).val()).trim();
            if (apiKey.length) {
                await writeSecret(config.key, apiKey);
            }

            if (!secret_state[config.key] && (!config.proxy || !oai_settings.reverse_proxy) && !config.keyless) {
                toastr.error(t`Please enter an API key or select a saved key.`);
                return;
            }
        }

        startStatusLoading();
        saveSettingsDebounced();
        await getStatusOpen();
    } catch (error) {
        toastr.error(toUserFacingErrorText(error));
        resultCheckStatus();
    }

}
