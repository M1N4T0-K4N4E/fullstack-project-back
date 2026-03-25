ALTER TABLE "post_dislikes" DROP CONSTRAINT "post_dislikes_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "post_dislikes" DROP CONSTRAINT "post_dislikes_post_id_posts_id_fk";
--> statement-breakpoint
ALTER TABLE "post_likes" DROP CONSTRAINT "post_likes_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "post_likes" DROP CONSTRAINT "post_likes_post_id_posts_id_fk";
--> statement-breakpoint
ALTER TABLE "post_dislikes" ADD CONSTRAINT "post_dislikes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_dislikes" ADD CONSTRAINT "post_dislikes_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_likes" ADD CONSTRAINT "post_likes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_likes" ADD CONSTRAINT "post_likes_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;