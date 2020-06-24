const GlobalConfigService = require('../../backend/services/globalConfigService');

module.exports = {
    initTestConfig: async function() {
        await GlobalConfigService.create({
            name: 'smtp',
            value: {
                'email-enabled': false,
                email: 'fyipedevtest1@gmail.com',
                password: 'H2Q2ALqEpknLKsPdRgDmkQfpFsiG8KgEq',
                'from-name': 'Fyipe',
                'smtp-server': 'smtp.gmail.com',
                'smtp-port': '465',
                'smtp-secure': true,
            },
        });

        await GlobalConfigService.create({
            name: 'twilio',
            value: {
                'sms-enabled': false,
                'call-enabled': false,
                'account-sid': 'AC4b957669470069d68cd5a09d7f91d7c6',
                'authentication-token': '79a35156d9967f0f6d8cc0761ef7d48d',
                phone: '+14143958232',
                'alert-limit': 100,
                'verification-sid': 'VA0832f242a8d417136df936f3e12af8c1',
            },
        });
    },

    removeTestConfig: async function() {
        await GlobalConfigService.hardDeleteBy({});
    },
};
