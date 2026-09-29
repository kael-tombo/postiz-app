# SocialFlow NodeJS SDK

This is the NodeJS SDK for [SocialFlow](https://socialflow.ai).

You can start by installing the package:

```bash
npm install @postiz/node
```

## Usage
```typescript
import SocialFlow from '@postiz/node';
const postiz = new SocialFlow('your api key', 'your self-hosted instance (optional)');
```

The available methods are:
- `post(posts: CreatePostDto)` - Schedule a post to SocialFlow
- `postList(filters: GetPostsDto)` - Get a list of posts
- `upload(file: Buffer, extension: string)` - Upload a file to SocialFlow
- `integrations()` - Get a list of connected channels
- `deletePost(id: string)` - Delete a post by ID

Alternatively you can use the SDK with curl, check the [SocialFlow API documentation](https://docs.socialflow.ai/public-api) for more information.