module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  const baseUrl = 'https://your-vercel-project-url.vercel.app';

  res.status(200).json({
    success: true,
    message: 'Avatar API is ready.',
    endpoints: {
      avatar: `${baseUrl}/api/avatar?email=hello@example.com`,
      example_response: {
        success: true,
        email: 'hello@example.com',
        avatar: 'https://www.gravatar.com/avatar/....?s=512&d=mp&r=g',
        avatar_url: 'https://www.gravatar.com/avatar/....?s=512&d=mp&r=g',
        pfp: 'https://www.gravatar.com/avatar/....?s=512&d=mp&r=g',
        profile_picture: 'https://www.gravatar.com/avatar/....?s=512&d=mp&r=g',
        provider: 'gravatar'
      }
    }
  });
};
