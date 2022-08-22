import {
  Client,
  Collection,
  CommandInteraction,
  PermissionFlagsBits,
  TextChannel,
} from "discord.js";
import DistubePlayer from "distube";
import { AuroraClientOptions } from "./AuroraClientOptions";
import { Command } from "./Command";
import { SoundCloudPlugin } from "@distube/soundcloud";
import { SpotifyPlugin } from "@distube/spotify";
import { YtDlpPlugin } from "@distube/yt-dlp";
import * as Config from "../config.json";
import * as Package from "../package.json";
import { AuroraEventManager } from "./AuroraEventManager";
import { PrismaClient } from "@prisma/client";
import { SubCommand } from "./SubCommand";
import { AuroraLocaleManager } from "./AuroraLocaleManager";
import { AuroraTempManager } from "./AuroraTempManager";
import { EmbedBuilder, TimestampStylesString } from "discord.js";
import { Prisma } from "@prisma/client";

export class AuroraClient extends Client<true> {
  interactions: Collection<string, Command | SubCommand> = new Collection();
  player: DistubePlayer;
  config: typeof Config;
  package: typeof Package;
  db: PrismaClient;
  tempvoices: AuroraTempManager;
  locales: AuroraLocaleManager;

  constructor() {
    super(AuroraClientOptions);

    this.db = new PrismaClient();
    this.player = new DistubePlayer(this, {
      nsfw: false,
      emitNewSongOnly: true,
      plugins: [new YtDlpPlugin(), new SpotifyPlugin(), new SoundCloudPlugin()],
    });
    this.config = Config;
    this.package = Package;
    this.tempvoices = new AuroraTempManager(this);
    this.locales = new AuroraLocaleManager(this);
  }

  init() {
    this.locales.init();
    new AuroraEventManager(this).init();

    this.db.$connect();
    this.login(process.env["CLIENT_TOKEN"]);
  }

  /**
   * Returns a pre-formatted embed
   * @param {Interaction} interaction Your interaction (aka slash command)
   */
  embed(interaction: any) {
    if (!interaction) {
      throw Error("Expected interaction to be provided (embed)");
    }

    return new EmbedBuilder()
      .setFooter({
        text: this.config.embeds.showAuthor ? interaction.user?.tag : null,
        iconURL: this.config.embeds.showAuthor
          ? interaction.user?.displayAvatarURL()
          : null,
      })
      .setColor(parseInt(this.config.embeds.hexColor, 16) ?? "#7289da")
      .setTimestamp(this.config.embeds.setTimestamp ? Date.now() : null);
  }

  /**
   * Returns a formatted reply
   * @param {string} replyContent Reply content you would like to format
   * @param {string} emoji Emoji you would like to add
   */
  reply(replyContent: string, emoji: string) {
    return `${emoji} | ${replyContent}`;
  }

  /**
   * Returns a formatted time
   * @param { string | number | Date } timestamp Your timestamp
   * @param {TimestampStylesString} type Formatting type
   */
  formatTime(timestamp: string | number | Date, type: TimestampStylesString) {
    const parsed = new Date(timestamp).getTime() / 1000;
    if (!timestamp) {
      throw Error("time isn't provided (formatTime)");
    } else if (!parsed) {
      throw Error("time isn't parsable (formatTime)");
    }

    return `<t:${parseInt(parsed.toString())}:${type ?? "F"}>`;
  }

  async addUser(user_id: string, guild_id: string | undefined, data?: any) {
    if (!guild_id) return null;

    try {
      const user = await this.db.user.create({
        data: {
          user_id: user_id,
          guild_id: guild_id,
          ...data,
        },
      });

      return user;
    } catch (error) {
      console.log(error);
    }
  }

  async updateUser(
    user_id: string,
    guild_id: string | undefined,
    data: Partial<Prisma.UserUpdateManyArgs["data"]>
  ) {
    try {
      const user = await this.getUser(user_id, guild_id);

      if (!user) {
        this.addUser(user_id, guild_id, data);
        return;
      }

      await this.db.user.updateMany({
        where: { user_id: user_id, guild_id: guild_id },
        data,
      });
    } catch (error) {
      console.log(error);
    }
  }

  async removeUser(user_id: string, guild_id: string) {
    try {
      await this.db.user.deleteMany({
        where: { user_id: user_id, guild_id: guild_id },
      });
    } catch (error) {
      console.log(error);
    }
  }

  async getGuild(guild_id: string | undefined | null) {
    if (!guild_id) return null;

    try {
      const guild =
        (await this.db.guild.findFirst({
          where: { guild_id: guild_id },
        })) ?? (await this.addGuild(guild_id));

      return guild;
    } catch (error) {
      console.log(error);
    }
  }

  async getUser(user_id: string, guild_id: string | undefined) {
    if (!guild_id) return null;

    try {
      const user =
        (await this.db.user.findFirst({
          where: { user_id: user_id, guild_id: guild_id },
        })) ?? (await this.addUser(user_id, guild_id));

      return user;
    } catch (error) {
      console.log(error);
    }
  }

  async addGuild(guild_id: string | undefined) {
    if (!guild_id) return null;

    try {
      const guild = await this.db.guild.create({
        data: {
          guild_id: guild_id,
        },
      });

      return guild;
    } catch (error) {
      console.log(error);
    }
  }

  async updateGuild(
    guild_id: string | undefined,
    data: Partial<Prisma.GuildUpdateInput>
  ) {
    if (!guild_id) return;

    try {
      const guild = await this.getGuild(guild_id);

      if (!guild) {
        await this.addGuild(guild_id);
      }

      await this.db.guild.updateMany({
        where: { guild_id: guild_id },
        data,
      });
    } catch (error) {
      console.log(error);
    }
  }

  async deleteGuild(guild_id: string): Promise<void> {
    try {
      await this.db.guild.deleteMany({ where: { guild_id: guild_id } });
    } catch (error) {
      console.log(error);
    }
  }

  async vc(
    interaction: any,
    locale: any,
    checkConnection?: boolean,
    checkQueue?: boolean,
    checkLast?: boolean
  ) {
    const connection =
      this.player.voices.get(interaction.guild.id) ||
      interaction.guild.members.me!.voice;
    const queue = await interaction.client.player.queues.get(
      interaction.guild.id
    );

    if (!interaction.member.voice.channel) {
      return interaction.followUp({
        content: this.reply(locale("misc:voice:not_in_voice"), ":x:"),
      });
    } else if (
      interaction.guild.afkChannel &&
      interaction.member.voice.channel.id === interaction.guild.afkChannel.id
    ) {
      return interaction.followUp({
        content: this.reply(locale("misc:voice:in_afk"), ":x:"),
      });
    } else if (interaction.member.voice.selfDeaf) {
      return interaction.followUp({
        content: this.reply(locale("misc:voice:self_deaf"), ":x:"),
      });
    } else if (interaction.member.voice.serverDeaf) {
      return interaction.followUp({
        content: this.reply(locale("misc:voice:server_deaf"), ":x:"),
      });
    } else if (
      interaction.client.voice.channel &&
      interaction.client.voice.channel.id !==
        interaction.member.voice.channel.id
    ) {
      return interaction.followUp({
        content: this.reply(locale("misc:voice:not_same_channel"), ":x:"),
      });
    }

    if (checkConnection) {
      if (!connection) {
        return interaction.followUp({
          content: this.reply(locale("misc:voice:no_connection"), ":x:"),
        });
      }
    }
    if (checkQueue) {
      if (!queue) {
        return interaction.followUp({
          content: this.reply(locale("misc:voice:no_queue"), ":x:"),
        });
      }

      if (checkLast) {
        if (!queue || queue.songs.length === 1) {
          return interaction.followUp({
            content: this.reply(
              locale("misc:voice:last_song", { cmd: `\`/music stop\`` }),
              ":x:"
            ),
          });
        }
      }
      return true;
    }
  }

  clientPerms(
    permissions: bigint[],
    interaction: CommandInteraction,
    locale: any
  ) {
    const neededPerms: bigint[] = [];

    permissions.forEach((perm) => {
      if (
        !(interaction.channel as TextChannel)
          .permissionsFor(interaction.guild!.members.me!)
          .has(perm)
      ) {
        neededPerms.push(perm);
      }
    });
    if (neededPerms.length > 0) {
      return locale("misc:member_need_perms", {
        perms: neededPerms
          .map((p) => {
            const perms: string[] = [];
            Object.keys(PermissionFlagsBits).map((key) => {
              if (PermissionFlagsBits[key] === p) {
                perms.push(`* ${locale(`permissions:${key}`)}`);
              }
            });

            return perms;
          })
          .join("\n"),
      });
    }
  }

  userPerms(
    permissions: bigint[],
    interaction: CommandInteraction,
    locale: any
  ) {
    const neededPerms: bigint[] = [];

    permissions.forEach((perm) => {
      if (
        !(interaction.channel as TextChannel)
          .permissionsFor(interaction.member as any)
          .has(perm)
      ) {
        neededPerms.push(perm);
      }
    });

    if (neededPerms.length > 0) {
      return locale("misc:user_need_perms", {
        perms: neededPerms
          .map((p) => {
            const perms: string[] = [];
            Object.keys(PermissionFlagsBits).map((key) => {
              if (PermissionFlagsBits[key] === p) {
                perms.push(`* ${locale(`permissions:${key}`)}`);
              }
            });

            return perms;
          })
          .join("\n"),
      });
    }
  }
}
