import ObjectID from 'Common/Types/ObjectID';
import Phone from 'Common/Types/Phone';
import {
    SMSDefaultCostInCents,
    TwilioAccountSid,
    TwilioAuthToken,
    TwilioPhoneNumber,
} from '../Config';
import Twilio from 'twilio';
import BadDataException from 'Common/Types/Exception/BadDataException';
import SmsLog from 'Model/Models/SmsLog';
import SmsStatus from 'Common/Types/SmsStatus';
import { IsBillingEnabled } from 'CommonServer/Config';
import SmsLogService from 'CommonServer/Services/SmsLogService';
import ProjectService from 'CommonServer/Services/ProjectService';
import Project from 'Model/Models/Project';
import { MessageInstance } from 'twilio/lib/rest/api/v2010/account/message';
import NotificationService from 'CommonServer/Services/NotificationService';

export default class SmsService {
    public static async sendSms(
        to: Phone,
        message: string,
        options: {
            projectId?: ObjectID | undefined; // project id for sms log
            from: Phone; // from phone number
        }
    ): Promise<void> {
        if (!TwilioAccountSid) {
            throw new BadDataException('TwilioAccountSid is not configured');
        }

        if (!TwilioAuthToken) {
            throw new BadDataException('TwilioAuthToken is not configured');
        }

        if (!TwilioPhoneNumber) {
            throw new BadDataException('TwilioPhoneNumber is not configured');
        }

        const client: Twilio.Twilio = Twilio(TwilioAccountSid, TwilioAuthToken);

        const smsLog: SmsLog = new SmsLog();
        smsLog.toNumber = to;
        smsLog.fromNumber = options.from || new Phone(TwilioPhoneNumber);
        smsLog.smsText = message;
        smsLog.smsCostInUSDCents = 0;

        if (options.projectId) {
            smsLog.projectId = options.projectId;
        }

        let project: Project | null = null;

        try {
            // make sure project has enough balance.

            if (options.projectId && IsBillingEnabled) {
                project = await ProjectService.findOneById({
                    id: options.projectId,
                    select: {
                        smsOrCallCurrentBalanceInUSDCents: true,
                        enableSmsNotifications: true,
                        lowCallAndSMSBalanceNotificationSentToOwners: true,
                        name: true,
                        notEnabledSmsNotificationSentToOwners: true,
                    },
                    props: {
                        isRoot: true,
                    },
                });

                if (!project) {
                    smsLog.status = SmsStatus.Error;
                    smsLog.statusMessage = `Project ${options.projectId.toString()} not found.`;
                    await SmsLogService.create({
                        data: smsLog,
                        props: {
                            isRoot: true,
                        },
                    });
                    return;
                }

                if (!project.enableSmsNotifications) {
                    smsLog.status = SmsStatus.Error;
                    smsLog.statusMessage = `SMS notifications are not enabled for this project. Please enable SMS notifications in project settings.`;

                    await SmsLogService.create({
                        data: smsLog,
                        props: {
                            isRoot: true,
                        },
                    });
                    if (!project.notEnabledSmsNotificationSentToOwners) {
                        await ProjectService.updateOneById({
                            data: {
                                notEnabledSmsNotificationSentToOwners: true,
                            },
                            id: project.id!,
                            props: {
                                isRoot: true,
                            },
                        });
                        await ProjectService.sendEmailToProjectOwners(
                            project.id!,
                            'SMS notifications not enabled for ' +
                                (project.name || ''),
                            `We tried to send an SMS to ${to.toString()} with message: <br/> <br/> ${message} <br/> <br/> This SMS was not sent because SMS notifications are not enabled for this project. Please enable SMS notifications in project settings.`
                        );
                    }
                    return;
                }

                // check if auto recharge is enabled and current balance is low.
                const updatedBalance: number =
                    await NotificationService.rechargeIfBalanceIsLow(
                        project.id!
                    );
                project.smsOrCallCurrentBalanceInUSDCents = updatedBalance;

                if (!project.smsOrCallCurrentBalanceInUSDCents) {
                    smsLog.status = SmsStatus.LowBalance;
                    smsLog.statusMessage = `Project ${options.projectId.toString()} does not have enough SMS balance.`;
                    await SmsLogService.create({
                        data: smsLog,
                        props: {
                            isRoot: true,
                        },
                    });

                    if (!project.lowCallAndSMSBalanceNotificationSentToOwners) {
                        await ProjectService.updateOneById({
                            data: {
                                lowCallAndSMSBalanceNotificationSentToOwners:
                                    true,
                            },
                            id: project.id!,
                            props: {
                                isRoot: true,
                            },
                        });
                        await ProjectService.sendEmailToProjectOwners(
                            project.id!,
                            'Low SMS and Call Balance for ' +
                                (project.name || ''),
                            `We tried to send an SMS to ${to.toString()} with message: <br/> <br/> ${message} <br/>This SMS was not sent because project does not have enough balance to send SMS. Current balance is ${
                                project.smsOrCallCurrentBalanceInUSDCents || 0
                            } USD cents. Required balance to send this SMS should is ${SMSDefaultCostInCents} USD cents. Please enable auto recharge or recharge manually.`
                        );
                    }
                    return;
                }

                if (
                    project.smsOrCallCurrentBalanceInUSDCents <
                    SMSDefaultCostInCents
                ) {
                    smsLog.status = SmsStatus.LowBalance;
                    smsLog.statusMessage = `Project does not have enough balance to send SMS. Current balance is ${project.smsOrCallCurrentBalanceInUSDCents} cents. Required balance is ${SMSDefaultCostInCents} cents to send this SMS.`;
                    await SmsLogService.create({
                        data: smsLog,
                        props: {
                            isRoot: true,
                        },
                    });
                    if (!project.lowCallAndSMSBalanceNotificationSentToOwners) {
                        await ProjectService.updateOneById({
                            data: {
                                lowCallAndSMSBalanceNotificationSentToOwners:
                                    true,
                            },
                            id: project.id!,
                            props: {
                                isRoot: true,
                            },
                        });
                        await ProjectService.sendEmailToProjectOwners(
                            project.id!,
                            'Low SMS and Call Balance for ' +
                                (project.name || ''),
                            `We tried to send an SMS to ${to.toString()} with message: <br/> <br/> ${message} <br/> <br/> This SMS was not sent because project does not have enough balance to send SMS. Current balance is ${
                                project.smsOrCallCurrentBalanceInUSDCents
                            } cents. Required balance is ${SMSDefaultCostInCents} cents to send this SMS. Please enable auto recharge or recharge manually.`
                        );
                    }
                    return;
                }
            }

            const twillioMessage: MessageInstance =
                await client.messages.create({
                    body: message,
                    to: to.toString(),
                    from:
                        options && options.from
                            ? options.from.toString()
                            : TwilioPhoneNumber.toString(), // From a valid Twilio number
                });

            smsLog.status = SmsStatus.Success;
            smsLog.statusMessage = 'Message ID: ' + twillioMessage.sid;

            if (IsBillingEnabled && project) {
                smsLog.smsCostInUSDCents = SMSDefaultCostInCents;

                project.smsOrCallCurrentBalanceInUSDCents = Math.floor(
                    project.smsOrCallCurrentBalanceInUSDCents! -
                        SMSDefaultCostInCents
                );

                await ProjectService.updateOneById({
                    data: {
                        smsOrCallCurrentBalanceInUSDCents:
                            project.smsOrCallCurrentBalanceInUSDCents,
                        notEnabledSmsNotificationSentToOwners: false, // reset this flag
                    },
                    id: project.id!,
                    props: {
                        isRoot: true,
                    },
                });
            }
        } catch (e: any) {
            smsLog.smsCostInUSDCents = 0;
            smsLog.status = SmsStatus.Error;
            smsLog.statusMessage =
                e && e.message ? e.message.toString() : e.toString();
        }

        if (options.projectId) {
            await SmsLogService.create({
                data: smsLog,
                props: {
                    isRoot: true,
                },
            });
        }
    }
}
